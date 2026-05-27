"""
CRUD (Create, Read, Update, Delete) operations for the database.
"""
from sqlalchemy.orm import Session
from app.models import User, Message
from app.auth import get_password_hash
from datetime import datetime

# --- User CRUD ---
def get_user_by_username(db: Session, username: str):
    return db.query(User).filter(User.username == username).first()

def get_user_by_email(db: Session, email: str):
    return db.query(User).filter(User.email == email).first()

def get_user_by_id(db: Session, user_id: int):
    return db.query(User).filter(User.id == user_id).first()

def get_users(db: Session, skip: int = 0, limit: int = 100):
    return db.query(User).offset(skip).limit(limit).all()

def create_user(db: Session, username: str, email: str, password: str):
    db_user = User(
        username=username,
        email=email,
        password_hash=get_password_hash(password)
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

def update_user_status(db: Session, user_id: int, is_active: bool):
    user = get_user_by_id(db, user_id)
    if user:
        user.is_active = is_active
        db.commit()
        db.refresh(user)
    return user

def delete_user(db: Session, user_id: int):
    user = get_user_by_id(db, user_id)
    if user:
        db.delete(user)
        db.commit()
    return user

# --- Message CRUD ---
def create_message(db: Session, sender_id: int, receiver_id: int, content: str):
    db_message = Message(
        sender_id=sender_id,
        receiver_id=receiver_id,
        content=content,
        timestamp=datetime.utcnow()
    )
    db.add(db_message)
    db.commit()
    db.refresh(db_message)
    return db_message

def get_messages_between_users(db: Session, user1_id: int, user2_id: int, limit: int = 50):
    """Get conversation history between two users."""
    messages = db.query(Message).filter(
        ((Message.sender_id == user1_id) & (Message.receiver_id == user2_id)) |
        ((Message.sender_id == user2_id) & (Message.receiver_id == user1_id))
    ).order_by(Message.timestamp.asc()).limit(limit).all()
    return messages

def get_user_messages(db: Session, user_id: int, limit: int = 100):
    """Get all messages involving a specific user."""
    return db.query(Message).filter(
        (Message.sender_id == user_id) | (Message.receiver_id == user_id)
    ).order_by(Message.timestamp.desc()).limit(limit).all()

def mark_messages_as_read(db: Session, sender_id: int, receiver_id: int):
    """Mark messages from sender to receiver as read."""
    db.query(Message).filter(
        Message.sender_id == sender_id,
        Message.receiver_id == receiver_id,
        Message.read_status == False
    ).update({"read_status": True})
    db.commit()