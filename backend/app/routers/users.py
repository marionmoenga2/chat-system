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


# ---------- Last seen ----------
from pydantic import BaseModel
from app import models


class LastSeenSetting(BaseModel):
    show: bool


@router.get("/last-seen")
def get_last_seen(db: Session = Depends(get_db), current_user = Depends(auth.get_current_user)):
    """When people were last online. Hidden for anyone who switched it off,
    and you only see other people's if you share yours too."""
    if not current_user.show_last_seen:
        return {"enabled": False, "last_seen": {}}
    rows = db.query(models.User.id, models.User.last_seen).filter(
        models.User.last_seen.isnot(None), models.User.show_last_seen.is_(True)
    ).all()
    return {"enabled": True, "last_seen": {str(uid): ts.isoformat() + "Z" for uid, ts in rows}}


@router.get("/last-seen/setting")
def get_last_seen_setting(current_user = Depends(auth.get_current_user)):
    return {"show": bool(current_user.show_last_seen)}


@router.put("/last-seen/setting")
def set_last_seen_setting(
    body: LastSeenSetting,
    db: Session = Depends(get_db),
    current_user = Depends(auth.get_current_user)
):
    user = db.query(models.User).filter(models.User.id == current_user.id).first()
    user.show_last_seen = body.show
    db.commit()
    return {"show": body.show}
