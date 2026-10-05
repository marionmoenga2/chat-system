"""
Main FastAPI application entry point.
"""
import os
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.database import engine, Base, get_db
from app import auth, crud, schemas, models
from app.websocket_manager import manager
from app.routers import auth as auth_router, users, messages, admin, extras
from app.routers.extras import serialize_message

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


@app.websocket("/ws/{token}")
async def websocket_endpoint(websocket: WebSocket, token: str, db: Session = Depends(get_db)):
    try:
        payload = auth.jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        user_id = int(payload.get("sub"))
        user = crud.get_user_by_id(db, user_id)
        if not user or not user.is_active:
            await websocket.close(code=4001)
            return
    except Exception:
        await websocket.close(code=4001)
        return

    username = user.username

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
                msg_type = message_data.get("type", "private")
                content = (message_data.get("content") or "").strip()[:2000]

                receiver_id = message_data.get("receiver_id")
                try:
                    receiver_id = int(receiver_id) if receiver_id is not None else None
                except (TypeError, ValueError):
                    receiver_id = None

                if msg_type == "private" and receiver_id and content:
                    db_message = crud.create_message(
                        db,
                        sender_id=user_id,
                        receiver_id=receiver_id,
                        content=content
                    )

                    # Optional: this message is a reply to an earlier one
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

                    message_payload = {"type": "message", **serialize_message(db_message, db)}
                    await manager.send_personal_message(message_payload, receiver_id)
                    await manager.send_personal_message(message_payload, user_id)

                elif msg_type == "typing" and receiver_id:
                    await manager.send_personal_message({
                        "type": "typing",
                        "user_id": user_id,
                        "username": username
                    }, receiver_id)

            except Exception as exc:
                db.rollback()
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