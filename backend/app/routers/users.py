"""
User management endpoints.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app import crud, schemas, auth

router = APIRouter(prefix="/api/users", tags=["Users"])

@router.get("/", response_model=List[schemas.UserResponse])
def get_all_users(
    skip: int = 0, 
    limit: int = 100, 
    db: Session = Depends(get_db),
    current_user = Depends(auth.get_current_user)
):
    """
    Get list of all users (excluding sensitive data).
    Requires authentication.
    """
    users = crud.get_users(db, skip=skip, limit=limit)
    return users

@router.get("/online")
def get_online_users(current_user = Depends(auth.get_current_user)):
    """
    Get list of currently online user IDs.
    """
    from app.websocket_manager import manager
    online_ids = manager.get_online_users()
    return {"online_users": online_ids}