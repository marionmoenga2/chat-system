"""
Voice notes: short audio clips sent in private chats and groups.
The audio is stored in the database. Only the sender, the receiver (or the group's
members) can play a note, and notes older than 30 days are deleted.
"""
import base64
import binascii
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, undefer

from app.database import get_db
from app import auth, models

router = APIRouter(prefix="/api/voice", tags=["Voice notes"])

MAX_BYTES = 600_000
MAX_SECONDS = 125
KEEP_DAYS = 30
MAX_PER_10_MIN = 20
ALLOWED_MIME = {"audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/aac", "audio/x-m4a"}


class VoiceUpload(BaseModel):
    audio: str                      # base64 audio, without any "data:" prefix
    mime: str
    seconds: int
    to_user_id: Optional[int] = None
    group_id: Optional[int] = None


def _is_member(db: Session, group_id: int, user_id: int) -> bool:
    return db.query(models.GroupMember).filter(
        models.GroupMember.group_id == group_id, models.GroupMember.user_id == user_id
    ).first() is not None


@router.post("")
def upload(body: VoiceUpload, db: Session = Depends(get_db), me=Depends(auth.get_current_user)):
    if bool(body.to_user_id) == bool(body.group_id):
        raise HTTPException(status_code=400, detail="Choose one person or one group")
    mime = (body.mime or "").split(";")[0].strip().lower()
    if mime not in ALLOWED_MIME:
        raise HTTPException(status_code=400, detail="This audio format is not supported")
    try:
        raw = base64.b64decode(body.audio, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="The recording could not be read")
    if not raw or len(raw) > MAX_BYTES:
        raise HTTPException(status_code=400, detail="That voice note is too long. Keep it under 2 minutes.")

    if body.group_id:
        if not _is_member(db, body.group_id, me.id):
            raise HTTPException(status_code=403, detail="You are not in that group")
    else:
        target = db.query(models.User).filter(
            models.User.id == body.to_user_id, models.User.is_active == True
        ).first()
        if not target or target.id == me.id:
            raise HTTPException(status_code=404, detail="That person was not found")

    now = datetime.utcnow()
    recent = db.query(func.count(models.VoiceNote.id)).filter(
        models.VoiceNote.user_id == me.id, models.VoiceNote.created_at >= now - timedelta(minutes=10)
    ).scalar()
    if (recent or 0) >= MAX_PER_10_MIN:
        raise HTTPException(status_code=429, detail="You are sending voice notes too quickly. Please wait a few minutes.")

    db.query(models.VoiceNote).filter(models.VoiceNote.created_at < now - timedelta(days=KEEP_DAYS)).delete(synchronize_session=False)

    note = models.VoiceNote(
        user_id=me.id, to_user_id=body.to_user_id or None, group_id=body.group_id or None,
        mime=mime, seconds=max(1, min(int(body.seconds), MAX_SECONDS)), data=raw,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return {"id": note.id, "seconds": note.seconds}


@router.get("/{note_id}")
def fetch(note_id: int, db: Session = Depends(get_db), me=Depends(auth.get_current_user)):
    note = db.query(models.VoiceNote).options(undefer(models.VoiceNote.data)).filter(models.VoiceNote.id == note_id).first()
    allowed = bool(note) and (
        me.id == note.user_id
        or me.id == note.to_user_id
        or (note.group_id is not None and _is_member(db, note.group_id, me.id))
    )
    if not allowed:
        raise HTTPException(status_code=404, detail="Voice note not found")
    return Response(content=bytes(note.data), media_type=note.mime, headers={"Cache-Control": "private, max-age=86400"})
