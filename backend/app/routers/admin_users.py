"""
Admin user management: add users and reset passwords from the admin panel.
"""
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.database import get_db
from app import auth, crud, models

router = APIRouter(prefix="/api/admin-users", tags=["Admin: users"])

USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,50}$")


class NewUser(BaseModel):
    username: str
    email: EmailStr
    password: str
    is_admin: bool = False


class PasswordReset(BaseModel):
    password: str


def require_admin(current_user=Depends(auth.get_current_user)):
    if not getattr(current_user, "is_admin", False):
        raise HTTPException(status_code=403, detail="Administrators only")
    return current_user


def check_password(password: str):
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="The password must be at least 8 characters")
    if len(password) > 72:
        raise HTTPException(status_code=400, detail="The password can be at most 72 characters")


def hash_password(password: str) -> str:
    """Use the same hashing as the rest of the app, whatever auth.py calls it."""
    for name in ("get_password_hash", "hash_password", "get_hash"):
        fn = getattr(auth, name, None)
        if callable(fn):
            return fn(password)
    context = getattr(auth, "pwd_context", None)
    if context is not None:
        return context.hash(password)
    raise HTTPException(status_code=500, detail="Password hashing is not available")


def user_dict(u) -> dict:
    return {
        "id": u.id,
        "username": u.username,
        "email": u.email,
        "is_admin": bool(u.is_admin),
        "is_active": bool(u.is_active),
        "is_approved": bool(getattr(u, "is_approved", True)),
        "created_at": (u.created_at.isoformat() + "Z") if u.created_at else None,
    }


@router.get("/")
def list_users(
    db: Session = Depends(get_db),
    admin_user=Depends(require_admin),
):
    rows = db.query(models.User).order_by(models.User.created_at.desc()).all()
    return [user_dict(u) for u in rows]


@router.post("/")
def create_user(
    payload: NewUser,
    db: Session = Depends(get_db),
    admin_user=Depends(require_admin),
):
    username = payload.username.strip()
    email = str(payload.email).strip()

    if not USERNAME_RE.match(username):
        raise HTTPException(
            status_code=400,
            detail="Username must be 3 to 50 characters: letters, numbers, dots, dashes or underscores",
        )
    check_password(payload.password)

    if crud.get_user_by_username(db, username=username):
        raise HTTPException(status_code=400, detail="Username already registered")
    if crud.get_user_by_email(db, email=email):
        raise HTTPException(status_code=400, detail="Email already registered")

    user = crud.create_user(db, username=username, email=email, password=payload.password)
    user.is_admin = bool(payload.is_admin)
    if hasattr(models.User, "is_approved"):
        user.is_approved = True    # added by an admin, so no approval step is needed
    db.commit()
    db.refresh(user)
    return user_dict(user)


@router.put("/{user_id}/password")
def reset_password(
    user_id: int,
    payload: PasswordReset,
    db: Session = Depends(get_db),
    admin_user=Depends(require_admin),
):
    check_password(payload.password)

    user = db.get(models.User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.password_hash = hash_password(payload.password)
    db.commit()
    return {"ok": True}