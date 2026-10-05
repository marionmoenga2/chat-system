"""
Profile photos and chat history with reply support.
"""
import base64
import re

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app import auth, models

router = APIRouter(prefix="/api", tags=["Profile and chat extras"])

MAX_AVATAR_CHARS = 200_000  # roughly 150 KB of image data
DATA_URL_RE = re.compile(r"^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$")


class AvatarUpload(BaseModel):
    image: str


def serialize_message(m, db: Session) -> dict:
    """Turn a Message row into the JSON the frontend expects (with reply preview)."""
    reply = None
    if m.reply_to_id:
        original = db.get(models.Message, m.reply_to_id)
        if original:
            reply = {
                "id": original.id,
                "sender_id": original.sender_id,
                "sender_username": original.sender.username,
                "content": (original.content or "")[:140],
            }
    return {
        "id": m.id,
        "sender_id": m.sender_id,
        "sender_username": m.sender.username,
        "receiver_id": m.receiver_id,
        "content": m.content,
        "timestamp": m.timestamp.isoformat() + "Z",  # stored as UTC
        "read_status": m.read_status,
        "reply_to_id": m.reply_to_id,
        "reply_to": reply,
    }


# ---------- Profile photos ----------

@router.post("/profile/avatar")
def upload_avatar(
    payload: AvatarUpload,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    image = payload.image.strip()
    if len(image) > MAX_AVATAR_CHARS:
        raise HTTPException(status_code=413, detail="Image is too large")

    match = DATA_URL_RE.match(image)
    if not match:
        raise HTTPException(status_code=400, detail="Use a PNG, JPEG or WebP image")
    try:
        base64.b64decode(match.group(2), validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Corrupt image data")

    user = db.query(models.User).filter(models.User.id == current_user.id).first()
    user.avatar = image
    db.commit()
    return {"ok": True}


@router.delete("/profile/avatar")
def delete_avatar(
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    user = db.query(models.User).filter(models.User.id == current_user.id).first()
    user.avatar = None
    db.commit()
    return {"ok": True}


@router.get("/profile/avatars")
def list_avatars(
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    """Which users have a photo, plus a version token (the image size) for cache busting."""
    rows = (
        db.query(models.User.id, func.length(models.User.avatar))
        .filter(models.User.avatar.isnot(None))
        .all()
    )
    return {"avatars": {str(uid): int(length) for uid, length in rows}}


@router.get("/profile/avatar/{user_id}")
def get_avatar(user_id: int, db: Session = Depends(get_db)):
    """Public so it can be used in <img> tags (images cannot send login headers)."""
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user or not user.avatar:
        raise HTTPException(status_code=404, detail="No avatar")

    match = DATA_URL_RE.match(user.avatar)
    if not match:
        raise HTTPException(status_code=404, detail="No avatar")

    return Response(
        content=base64.b64decode(match.group(2)),
        media_type=f"image/{match.group(1)}",
        headers={"Cache-Control": "public, max-age=300"},
    )


# ---------- Chat history (includes reply info) ----------

@router.get("/chat/history/{other_id}")
def chat_history(
    other_id: int,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    limit = max(1, min(limit, 200))
    me = current_user.id

    rows = (
        db.query(models.Message)
        .filter(
            or_(
                and_(models.Message.sender_id == me, models.Message.receiver_id == other_id),
                and_(models.Message.sender_id == other_id, models.Message.receiver_id == me),
            )
        )
        .order_by(models.Message.timestamp.desc(), models.Message.id.desc())
        .limit(limit)
        .all()
    )
    rows.reverse()

    # Mark incoming messages as read
    changed = False
    for m in rows:
        if m.receiver_id == me and not m.read_status:
            m.read_status = True
            changed = True
    if changed:
        db.commit()

    return [serialize_message(m, db) for m in rows]