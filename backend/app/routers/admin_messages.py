"""
Admin messaging: send one announcement to many users at once.
One-to-one messages from the admin use the normal chat WebSocket, like any other user.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app import auth, crud, models
from app.routers.extras import serialize_message
from app.websocket_manager import manager

router = APIRouter(prefix="/api/admin-messages", tags=["Admin messaging"])

MAX_RECIPIENTS = 500
MAX_LENGTH = 2000


class Broadcast(BaseModel):
    content: str
    audience: str = "online"   # "online" or "all"


def require_admin(current_user=Depends(auth.get_current_user)):
    if not getattr(current_user, "is_admin", False):
        raise HTTPException(status_code=403, detail="Administrators only")
    return current_user


@router.post("/broadcast")
async def broadcast(
    payload: Broadcast,
    db: Session = Depends(get_db),
    admin_user=Depends(require_admin),
):
    content = (payload.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Write a message first")
    if len(content) > MAX_LENGTH:
        raise HTTPException(status_code=400, detail=f"Messages can be up to {MAX_LENGTH} characters")
    if payload.audience not in ("online", "all"):
        raise HTTPException(status_code=400, detail="Audience must be 'online' or 'all'")

    if payload.audience == "online":
        online_ids = [int(i) for i in manager.get_online_users()]
        rows = (
            db.query(models.User.id)
            .filter(models.User.id.in_(online_ids), models.User.is_active.is_(True))
            .all()
            if online_ids else []
        )
    else:
        rows = db.query(models.User.id).filter(models.User.is_active.is_(True)).all()

    recipients = [r[0] for r in rows if r[0] != admin_user.id][:MAX_RECIPIENTS]

    sent = 0
    for rid in recipients:
        try:
            msg = crud.create_message(db, sender_id=admin_user.id, receiver_id=rid, content=content)
            out = {"type": "message", **serialize_message(msg, db)}
            await manager.send_personal_message(out, rid)
            sent += 1
        except Exception as exc:
            db.rollback()
            print("Broadcast error:", repr(exc))

    return {"ok": True, "sent": sent, "audience": payload.audience}