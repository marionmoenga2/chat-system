"""
Admin-only endpoints for user management and monitoring.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, undefer
from typing import List, Optional
from app.database import get_db
from app import crud, schemas, auth, models, settings_store
from app.websocket_manager import manager
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/admin", tags=["Admin"])

@router.get("/users", response_model=List[schemas.AdminUserResponse])
def admin_get_all_users(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    admin = Depends(auth.get_current_admin)
):
    """Get all users (Admin only)."""
    return db.query(models.User).options(undefer(models.User.phone)).order_by(models.User.id).offset(skip).limit(limit).all()

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


# ---------- Settings ----------

class SettingsUpdate(BaseModel):
    maintenance_mode: Optional[bool] = None
    max_call_participants: Optional[int] = Field(default=None, ge=2, le=12)


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=72)


def _current_settings():
    return {
        "maintenance_mode": settings_store.get_bool("maintenance_mode"),
        "max_call_participants": settings_store.get_int("max_call_participants"),
    }


@router.get("/settings")
def get_settings(admin = Depends(auth.get_current_admin)):
    """Current admin-editable settings."""
    return _current_settings()


@router.put("/settings")
async def update_settings(body: SettingsUpdate, admin = Depends(auth.get_current_admin)):
    """Change settings. Everyone online is told when maintenance mode switches."""
    was_on = settings_store.get_bool("maintenance_mode")
    updates = {}
    if body.maintenance_mode is not None:
        updates["maintenance_mode"] = "true" if body.maintenance_mode else "false"
    if body.max_call_participants is not None:
        updates["max_call_participants"] = body.max_call_participants
    if updates:
        settings_store.set_values(updates)

    if body.maintenance_mode is not None and body.maintenance_mode != was_on:
        await manager.broadcast({
            "type": "maintenance",
            "on": body.maintenance_mode,
            "message": "Chat is under maintenance. Please try again soon."
                       if body.maintenance_mode else "Chat is back. You can send messages again.",
        })
    return _current_settings()


@router.post("/change-password")
def change_password(
    body: PasswordChange,
    db: Session = Depends(get_db),
    admin = Depends(auth.get_current_admin)
):
    """Change the logged-in admin's own password."""
    if not auth.verify_password(body.current_password, admin.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    admin.password_hash = auth.get_password_hash(body.new_password)
    db.commit()
    return {"message": "Password changed"}


# ---------- AI assistant key (managed from the admin panel) ----------
import os
from pydantic import BaseModel
from app import secret_store

AI_KEY_NAME = "anthropic_api_key"


class AiKeyUpdate(BaseModel):
    api_key: str


def _env_ai_key() -> str:
    return os.getenv("ANTHROPIC_API_KEY", "").strip().strip(chr(34) + chr(39)).strip()


def _ai_key_status() -> dict:
    env_key = _env_ai_key()
    saved = secret_store.get(AI_KEY_NAME)
    key = env_key or saved
    return {
        "configured": bool(key),
        "source": "render" if env_key else ("admin" if saved else None),
        "last4": key[-4:] if key else None,
        "has_saved": bool(saved),
    }


async def _test_anthropic_key(key: str) -> str:
    """One tiny request, to tell the admin straight away whether the key works."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                json={"model": os.getenv("AI_MODEL", "claude-haiku-4-5-20251001"), "max_tokens": 1,
                      "messages": [{"role": "user", "content": "hi"}]},
            )
    except Exception:
        return "unreachable"
    if r.status_code == 200:
        return "ok"
    if r.status_code in (401, 403):
        return "rejected"
    if r.status_code == 429:
        return "rate_limited"
    return f"error_{r.status_code}"


@router.get("/ai-key")
def ai_key_status(admin = Depends(auth.get_current_admin)):
    return _ai_key_status()


@router.put("/ai-key")
async def set_ai_key(body: AiKeyUpdate, admin = Depends(auth.get_current_admin)):
    key = (body.api_key or "").strip().strip(chr(34) + chr(39)).strip()
    if not key.startswith("sk-ant-") or not (40 <= len(key) <= 400):
        raise HTTPException(status_code=400, detail="That does not look like an Anthropic API key. It should start with sk-ant-")
    secret_store.save(AI_KEY_NAME, key)
    result = await _test_anthropic_key(key)
    return {"saved": True, "test": result, "last4": key[-4:]}


@router.delete("/ai-key")
def remove_ai_key(admin = Depends(auth.get_current_admin)):
    secret_store.remove(AI_KEY_NAME)
    return {"removed": True}


# ---------- Gemini key (managed from the admin panel) ----------
from app import gemini_client

GEMINI_KEY_NAME = "gemini_api_key"


def _clean_key(value) -> str:
    return (value or "").strip().strip(chr(34) + chr(39)).strip()


def _gemini_status() -> dict:
    env_key = _clean_key(os.getenv("GEMINI_API_KEY", ""))
    saved = secret_store.get(GEMINI_KEY_NAME)
    key = env_key or saved
    return {
        "configured": bool(key),
        "source": "render" if env_key else ("admin" if saved else None),
        "last4": key[-4:] if key else None,
        "has_saved": bool(saved),
    }


@router.get("/gemini-key")
def gemini_key_status(admin = Depends(auth.get_current_admin)):
    return _gemini_status()


@router.put("/gemini-key")
async def set_gemini_key(body: AiKeyUpdate, admin = Depends(auth.get_current_admin)):
    key = _clean_key(body.api_key)
    if not (20 <= len(key) <= 200) or any(ch.isspace() for ch in key):
        raise HTTPException(status_code=400, detail="That does not look like a Gemini API key. Copy the whole key from Google AI Studio.")
    try:
        await gemini_client.generate(key, "Reply with one short word.", [{"role": "user", "content": "Say hi"}], max_tokens=200)
        result = "ok"
    except gemini_client.GeminiError as exc:
        result = exc.code
    if result == "rejected":
        raise HTTPException(status_code=400, detail="Google rejected this key. Check that you copied the whole key from AI Studio.")
    secret_store.save(GEMINI_KEY_NAME, key)
    return {"saved": True, "test": result, "last4": key[-4:]}


@router.delete("/gemini-key")
def remove_gemini_key(admin = Depends(auth.get_current_admin)):
    secret_store.remove(GEMINI_KEY_NAME)
    return {"removed": True}
