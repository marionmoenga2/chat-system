"""
Admin-only endpoints for user management and monitoring.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from app.database import get_db
from app import crud, schemas, auth, models

router = APIRouter(prefix="/api/admin", tags=["Admin"])

@router.get("/users", response_model=List[schemas.UserResponse])
def admin_get_all_users(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    admin = Depends(auth.get_current_admin)
):
    """Get all users (Admin only)."""
    return crud.get_users(db, skip=skip, limit=limit)

@router.post("/users/{user_id}/ban")
def ban_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin = Depends(auth.get_current_admin)
):
    """Ban a user by setting is_active to False."""
    user = crud.update_user_status(db, user_id, False)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": f"User {user.username} has been banned"}

@router.post("/users/{user_id}/unban")
def unban_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin = Depends(auth.get_current_admin)
):
    """Unban a user by setting is_active to True."""
    user = crud.update_user_status(db, user_id, True)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": f"User {user.username} has been unbanned"}

@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin = Depends(auth.get_current_admin)
):
    """Permanently delete a user and their messages."""
    # Prevent admin from deleting themselves
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    
    user = crud.delete_user(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": f"User {user.username} has been deleted"}

@router.get("/messages")
def admin_get_messages(
    search: Optional[str] = None,
    user_id: Optional[int] = None,
    limit: int = 100,
    db: Session = Depends(get_db),
    admin = Depends(auth.get_current_admin)
):
    """
    Get all messages with optional search and filter.
    Admin only.
    """
    query = db.query(models.Message)
    
    if user_id:
        query = query.filter(
            (models.Message.sender_id == user_id) | 
            (models.Message.receiver_id == user_id)
        )
    
    if search:
        query = query.filter(models.Message.content.contains(search))
    
    messages = query.order_by(models.Message.timestamp.desc()).limit(limit).all()
    return messages

@router.get("/stats")
def get_dashboard_stats(
    db: Session = Depends(get_db),
    admin = Depends(auth.get_current_admin)
):
    """Get dashboard statistics."""
    total_users = db.query(models.User).count()
    total_messages = db.query(models.Message).count()
    active_users = db.query(models.User).filter(models.User.is_active == True).count()
    
    from app.websocket_manager import manager
    online_now = len(manager.get_online_users())
    
    return {
        "total_users": total_users,
        "total_messages": total_messages,
        "active_users": active_users,
        "online_now": online_now
    }