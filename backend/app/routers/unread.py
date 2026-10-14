"""
Unread message counts, so people who were offline can see who wrote to them.
Messages themselves are already saved when the receiver is offline.
"""
from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app import auth, models

router = APIRouter(prefix="/api/unread", tags=["Unread"])


@router.get("")
def unread_counts(db: Session = Depends(get_db), me=Depends(auth.get_current_user)):
    """How many unread messages I have from each person."""
    rows = (
        db.query(models.Message.sender_id, func.count(models.Message.id))
        .filter(models.Message.receiver_id == me.id, models.Message.read_status == False)
        .group_by(models.Message.sender_id)
        .all()
    )
    return {"counts": {str(sender_id): count for sender_id, count in rows}}


@router.post("/{sender_id}/read")
def mark_read(sender_id: int, db: Session = Depends(get_db), me=Depends(auth.get_current_user)):
    """Mark everything this person sent me as read."""
    db.query(models.Message).filter(
        models.Message.sender_id == sender_id,
        models.Message.receiver_id == me.id,
        models.Message.read_status == False,
    ).update({"read_status": True})
    db.commit()
    return {"ok": True}
