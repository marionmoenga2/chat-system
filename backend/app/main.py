"""
Main FastAPI application entry point.
"""
import os
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.database import engine, Base, SessionLocal
from app import auth, crud, models
from app.websocket_manager import manager
from app.routers import auth as auth_router, users, messages, admin, extras, groups
from app.routers.extras import serialize_message
from app.routers.groups import serialize_group_message, get_membership, member_ids_of

Base.metadata.create_all(bind=engine)
auth.SECRET_KEY = os.getenv("SECRET_KEY", "change-this-in-production")

app = FastAPI(
    title="Chat System API",
    description="Real-time chat system with FastAPI and WebSockets",
    version="1.0.0"
)

# CORS - allow all origins (tighten this once your frontend URLs are fixed)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,  # Must be False when origins=["*"]
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(users.router)
app.include_router(messages.router)
app.include_router(admin.router)
app.include_router(extras.router)
app.include_router(groups.router)

# Call setup messages that are relayed between users
CALL_TYPES = {
    "call_offer", "call_answer", "call_ice", "call_end", "call_reject",
    "call_media", "call_invite", "call_roster",
}


def process_private(db: Session, user_id: int, receiver_id: int, content: str, message_data: dict):
    """Save a one-to-one message. Returns (payload, recipient ids)."""
    db_message = crud.create_message(
        db, sender_id=user_id, receiver_id=receiver_id, content=content
    )

    reply_to_id = message_data.get("reply_to_id")
    if reply_to_id:
        try:
            original = db.get(models.Message, int(reply_to_id))
        except (TypeError, ValueError):
            original = None
        # The original must belong to this same conversation
        if original and {original.sender_id, original.receiver_id} == {user_id, receiver_id}:
            db_message.reply_to_id = original.id
            db.commit()
            db.refresh(db_message)

    payload = {"type": "message", **serialize_message(db_message, db)}
    return payload, list({receiver_id, user_id})


def process_group(db: Session, user_id: int, message_data: dict, content: str):
    """Save a group message. Returns (payload, recipient ids) or None."""
    try:
        group_id = int(message_data.get("group_id"))
    except (TypeError, ValueError):
        return None

    if not get_membership(db, group_id, user_id):
        return None

    gm = models.GroupMessage(group_id=group_id, sender_id=user_id, content=content)
    db.add(gm)
    db.commit()
    db.refresh(gm)

    reply_to_id = message_data.get("reply_to_id")
    if reply_to_id:
        try:
            original = db.get(models.GroupMessage, int(reply_to_id))
        except (TypeError, ValueError):
            original = None
        if original and original.group_id == group_id:
            gm.reply_to_id = original.id
            db.commit()
            db.refresh(gm)

    payload = {"type": "group_message", **serialize_group_message(gm, db)}
    return payload, member_ids_of(db, group_id)


async def relay_call(user_id: int, username: str, receiver_id: int, msg_type: str, data: dict):
    """Pass a call setup message to the other person (only known fields, size limited)."""
    call_id = str(data.get("call_id") or "")[:64]
    relay = {
        "type": msg_type,
        "from_id": user_id,
        "from_username": username,
        "call_id": call_id,
    }

    sdp = data.get("sdp")
    if isinstance(sdp, dict) and isinstance(sdp.get("sdp"), str) and len(sdp["sdp"]) < 30000:
        relay["sdp"] = {"type": str(sdp.get("type", ""))[:16], "sdp": sdp["sdp"]}

    candidate = data.get("candidate")
    if isinstance(candidate, dict) and len(json.dumps(candidate)) < 3000:
        relay["candidate"] = candidate

    # People already in the call (used when adding someone to a call)
    participants = data.get("participants")
    if isinstance(participants, list):
        cleaned = []
        for p in participants[:8]:
            if not isinstance(p, dict):
                continue
            try:
                pid = int(p.get("id"))
            except (TypeError, ValueError):
                continue
            cleaned.append({"id": pid, "name": str(p.get("name") or "")[:50]})
        relay["participants"] = cleaned

    for key in ("video", "join"):
        if key in data:
            relay[key] = bool(data.get(key))
    if "reason" in data:
        relay["reason"] = str(data.get("reason"))[:32]

    if receiver_id not in manager.get_online_users():
        if msg_type in ("call_offer", "call_invite"):
            await manager.send_personal_message(
                {"type": "call_unavailable", "from_id": receiver_id, "call_id": call_id},
                user_id,
            )
        return

    await manager.send_personal_message(relay, receiver_id)


@app.websocket("/ws/{token}")
async def websocket_endpoint(websocket: WebSocket, token: str):
    # Check the login with a short-lived database session
    try:
        payload = auth.jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        user_id = int(payload.get("sub"))
        with SessionLocal() as db:
            user = crud.get_user_by_id(db, user_id)
            if not user or not user.is_active:
                await websocket.close(code=4001)
                return
            username = user.username
    except Exception:
        await websocket.close(code=4001)
        return

    await manager.connect(websocket, user_id)
    await manager.broadcast({
        "type": "user_status",
        "user_id": user_id,
        "username": username,
        "status": "online"
    })

    try:
        while True:
            data = await websocket.receive_text()

            try:
                message_data = json.loads(data)
                if not isinstance(message_data, dict):
                    continue

                msg_type = message_data.get("type", "private")
                content = (message_data.get("content") or "").strip()[:2000]

                receiver_id = message_data.get("receiver_id")
                try:
                    receiver_id = int(receiver_id) if receiver_id is not None else None
                except (TypeError, ValueError):
                    receiver_id = None

                outgoing = None

                if msg_type == "private" and receiver_id and content:
                    with SessionLocal() as db:
                        outgoing = process_private(db, user_id, receiver_id, content, message_data)

                elif msg_type == "group" and content:
                    with SessionLocal() as db:
                        outgoing = process_group(db, user_id, message_data, content)

                elif msg_type == "typing" and receiver_id:
                    await manager.send_personal_message({
                        "type": "typing",
                        "user_id": user_id,
                        "username": username
                    }, receiver_id)

                elif msg_type in CALL_TYPES and receiver_id and receiver_id != user_id:
                    await relay_call(user_id, username, receiver_id, msg_type, message_data)

                if outgoing:
                    out_payload, recipients = outgoing
                    for rid in recipients:
                        await manager.send_personal_message(out_payload, rid)

            except Exception as exc:
                print("WebSocket handler error:", repr(exc))

    except WebSocketDisconnect:
        manager.disconnect(user_id)
        await manager.broadcast({
            "type": "user_status",
            "user_id": user_id,
            "username": username,
            "status": "offline"
        })


@app.get("/")
def read_root():
    return {"message": "Chat System API is running", "docs": "/docs"}