"""
Message endpoints for fetching chat history.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app import crud, schemas, auth

router = APIRouter(prefix="/api/messages", tags=["Messages"])

@router.get("/history/{user_id}", response_model=List[schemas.MessageResponse])
def get_chat_history(
    user_id: int,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user = Depends(auth.get_current_user)
):
    """
    Get chat history between current user and specified user.
    """
    messages = crud.get_messages_between_users(db, current_user.id, user_id, limit)
    
    # Add sender username to each message for frontend display
    for msg in messages:
        msg.sender_username = msg.sender.username
    
    # Mark messages as read
    crud.mark_messages_as_read(db, user_id, current_user.id)
    
    return messages

@router.get("/unread-count")
def get_unread_count(
    db: Session = Depends(get_db),
    current_user = Depends(auth.get_current_user)
):
    """
    Get count of unread messages for current user.
    """
    from app.models import Message
    count = db.query(Message).filter(
        Message.receiver_id == current_user.id,
        Message.read_status == False
    ).count()
    return {"unread_count": count}