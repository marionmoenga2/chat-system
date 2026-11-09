"""
Status updates: short text or photo posts that every user can see for 24 hours.
"""
import re
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, undefer

from app.database import get_db
from app import auth, models

router = APIRouter(prefix="/api/status", tags=["Status"])

LIFETIME = timedelta(hours=24)
MAX_TEXT = 500
MAX_IMAGE_CHARS = 450_000
MAX_ACTIVE_PER_USER = 20
IMAGE_RE = re.compile(r"^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$")
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


class StatusCreate(BaseModel):
    text: Optional[str] = None
    image: Optional[str] = None
    bg: Optional[str] = None


def _iso(dt):
    return dt.isoformat() + "Z"


def _purge_expired(db: Session):
    cutoff = datetime.utcnow() - LIFETIME
    old = [r[0] for r in db.query(models.StatusPost.id).filter(models.StatusPost.created_at < cutoff).all()]
    if old:
        db.query(models.StatusView).filter(models.StatusView.status_id.in_(old)).delete(synchronize_session=False)
        db.query(models.StatusPost).filter(models.StatusPost.id.in_(old)).delete(synchronize_session=False)
        db.commit()


def _live_post(db: Session, status_id: int, with_image: bool = False):
    q = db.query(models.StatusPost)
    if with_image:
        q = q.options(undefer(models.StatusPost.image))
    post = q.filter(models.StatusPost.id == status_id).first()
    if not post or post.created_at < datetime.utcnow() - LIFETIME:
        raise HTTPException(status_code=404, detail="This status is no longer available")
    return post


@router.get("")
def feed(db: Session = Depends(get_db), me=Depends(auth.get_current_user)):
    """Every live status, grouped by person."""
    _purge_expired(db)
    rows = (
        db.query(models.StatusPost, models.User.username)
        .join(models.User, models.User.id == models.StatusPost.user_id)
        .filter(models.User.is_active == True)
        .order_by(models.StatusPost.created_at.asc())
        .all()
    )
    seen = {r[0] for r in db.query(models.StatusView.status_id).filter(models.StatusView.viewer_id == me.id).all()}
    my_ids = [p.id for p, _ in rows if p.user_id == me.id]
    view_counts = {}
    if my_ids:
        view_counts = dict(
            db.query(models.StatusView.status_id, func.count(models.StatusView.id))
            .filter(models.StatusView.status_id.in_(my_ids))
            .group_by(models.StatusView.status_id)
            .all()
        )
    groups = {}
    for post, username in rows:
        g = groups.setdefault(post.user_id, {
            "user_id": post.user_id, "username": username, "is_me": post.user_id == me.id, "items": []
        })
        item = {
            "id": post.id, "kind": post.kind, "text": post.text, "bg": post.bg,
            "created_at": _iso(post.created_at),
            "viewed": post.user_id == me.id or post.id in seen,
        }
        if post.user_id == me.id:
            item["views"] = int(view_counts.get(post.id, 0))
        g["items"].append(item)
    return {"groups": list(groups.values())}


@router.post("")
def create_status(body: StatusCreate, db: Session = Depends(get_db), me=Depends(auth.get_current_user)):
    text = (body.text or "").strip()[:MAX_TEXT]
    image = (body.image or "").strip() or None
    if not text and not image:
        raise HTTPException(status_code=400, detail="Write something or add a photo")
    if image and (len(image) > MAX_IMAGE_CHARS or not IMAGE_RE.match(image)):
        raise HTTPException(status_code=400, detail="That photo is not supported or is too large")
    bg = body.bg if body.bg and COLOR_RE.match(body.bg) else "#0f6b4f"

    cutoff = datetime.utcnow() - LIFETIME
    active = db.query(models.StatusPost).filter(
        models.StatusPost.user_id == me.id, models.StatusPost.created_at >= cutoff
    ).count()
    if active >= MAX_ACTIVE_PER_USER:
        raise HTTPException(status_code=400, detail=f"You already have {MAX_ACTIVE_PER_USER} active statuses. Delete one first.")

    post = models.StatusPost(
        user_id=me.id, kind="image" if image else "text",
        text=text or None, bg=bg, image=image,
    )
    db.add(post)
    db.commit()
    db.refresh(post)
    return {"id": post.id}


@router.get("/{status_id}/image")
def get_image(status_id: int, db: Session = Depends(get_db), me=Depends(auth.get_current_user)):
    post = _live_post(db, status_id, with_image=True)
    if not post.image:
        raise HTTPException(status_code=404, detail="No photo on this status")
    return {"image": post.image}


@router.post("/{status_id}/view")
def mark_viewed(status_id: int, db: Session = Depends(get_db), me=Depends(auth.get_current_user)):
    post = _live_post(db, status_id)
    if post.user_id == me.id:
        return {"ok": True}
    exists = db.query(models.StatusView).filter(
        models.StatusView.status_id == status_id, models.StatusView.viewer_id == me.id
    ).first()
    if not exists:
        db.add(models.StatusView(status_id=status_id, viewer_id=me.id))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
    return {"ok": True}


@router.get("/{status_id}/viewers")
def viewers(status_id: int, db: Session = Depends(get_db), me=Depends(auth.get_current_user)):
    post = _live_post(db, status_id)
    if post.user_id != me.id:
        raise HTTPException(status_code=403, detail="Only the owner can see who viewed a status")
    rows = (
        db.query(models.User.id, models.User.username, models.StatusView.viewed_at)
        .join(models.StatusView, models.StatusView.viewer_id == models.User.id)
        .filter(models.StatusView.status_id == status_id)
        .order_by(models.StatusView.viewed_at.desc())
        .all()
    )
    return {"viewers": [{"user_id": r[0], "username": r[1], "viewed_at": _iso(r[2])} for r in rows]}


@router.delete("/{status_id}")
def delete_status(status_id: int, db: Session = Depends(get_db), me=Depends(auth.get_current_user)):
    post = db.query(models.StatusPost).filter(models.StatusPost.id == status_id).first()
    if not post:
        return {"deleted": True}
    if post.user_id != me.id and not me.is_admin:
        raise HTTPException(status_code=403, detail="You can only delete your own status")
    db.query(models.StatusView).filter(models.StatusView.status_id == status_id).delete(synchronize_session=False)
    db.delete(post)
    db.commit()
    return {"deleted": True}
