"""
Group chats: create groups, manage members, group message history.
"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app import auth, models
from app.websocket_manager import manager

router = APIRouter(prefix="/api/groups", tags=["Groups"])

MAX_GROUP_NAME = 60
MAX_MEMBERS = 50


class GroupCreate(BaseModel):
    name: str
    member_ids: List[int] = []


class MembersAdd(BaseModel):
    user_ids: List[int]


class GroupRename(BaseModel):
    name: str


# ---------- helpers ----------

def clean_name(name: str) -> str:
    name = " ".join((name or "").split())
    if not name or len(name) > MAX_GROUP_NAME:
        raise HTTPException(
            status_code=400,
            detail=f"Group name must be 1 to {MAX_GROUP_NAME} characters",
        )
    return name


def get_membership(db: Session, group_id: int, user_id: int):
    return (
        db.query(models.GroupMember)
        .filter(
            models.GroupMember.group_id == group_id,
            models.GroupMember.user_id == user_id,
        )
        .first()
    )


def member_ids_of(db: Session, group_id: int) -> List[int]:
    rows = (
        db.query(models.GroupMember.user_id)
        .filter(models.GroupMember.group_id == group_id)
        .all()
    )
    return [r[0] for r in rows]


def require_group(db: Session, group_id: int, user_id: int, admin: bool = False):
    group = db.get(models.Group, group_id)
    membership = get_membership(db, group_id, user_id) if group else None
    if not group or not membership:
        raise HTTPException(status_code=404, detail="Group not found")
    if admin and not membership.is_admin:
        raise HTTPException(status_code=403, detail="Only group admins can do that")
    return group, membership


def serialize_group_message(m, db: Session) -> dict:
    reply = None
    if m.reply_to_id:
        original = db.get(models.GroupMessage, m.reply_to_id)
        if original:
            reply = {
                "id": original.id,
                "sender_id": original.sender_id,
                "sender_username": original.sender.username,
                "content": (original.content or "")[:140],
            }
    return {
        "id": m.id,
        "group_id": m.group_id,
        "sender_id": m.sender_id,
        "sender_username": m.sender.username,
        "content": m.content,
        "timestamp": m.timestamp.isoformat() + "Z",  # stored as UTC
        "reply_to_id": m.reply_to_id,
        "reply_to": reply,
    }


def group_summary(group, db: Session, me_id: int) -> dict:
    count = (
        db.query(models.GroupMember)
        .filter(models.GroupMember.group_id == group.id)
        .count()
    )
    last = (
        db.query(models.GroupMessage)
        .filter(models.GroupMessage.group_id == group.id)
        .order_by(models.GroupMessage.timestamp.desc(), models.GroupMessage.id.desc())
        .first()
    )
    membership = get_membership(db, group.id, me_id)

    last_message = None
    if last:
        last_message = {
            "sender_username": last.sender.username,
            "content": (last.content or "")[:80],
            "timestamp": last.timestamp.isoformat() + "Z",
        }

    return {
        "id": group.id,
        "name": group.name,
        "created_by": group.created_by,
        "created_at": group.created_at.isoformat() + "Z" if group.created_at else None,
        "member_count": count,
        "is_admin": bool(membership and membership.is_admin),
        "last_message": last_message,
    }


async def notify(user_ids, group_id: int):
    """Tell members' open apps to refresh their group list."""
    for uid in set(user_ids):
        try:
            await manager.send_personal_message(
                {"type": "group_update", "group_id": group_id}, uid
            )
        except Exception:
            pass


# ---------- endpoints ----------

@router.get("/")
def list_groups(
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    groups = (
        db.query(models.Group)
        .join(models.GroupMember, models.GroupMember.group_id == models.Group.id)
        .filter(models.GroupMember.user_id == current_user.id)
        .all()
    )
    result = [group_summary(g, db, current_user.id) for g in groups]
    result.sort(
        key=lambda g: (g["last_message"]["timestamp"] if g["last_message"] else g["created_at"]) or "",
        reverse=True,
    )
    return result


@router.post("/")
async def create_group(
    payload: GroupCreate,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    name = clean_name(payload.name)

    wanted = set(payload.member_ids) - {current_user.id}
    valid_ids = []
    if wanted:
        rows = (
            db.query(models.User.id)
            .filter(models.User.id.in_(wanted), models.User.is_active.is_(True))
            .all()
        )
        valid_ids = [r[0] for r in rows]

    if not valid_ids:
        raise HTTPException(status_code=400, detail="Add at least one other member")
    if len(valid_ids) + 1 > MAX_MEMBERS:
        raise HTTPException(status_code=400, detail=f"A group can have at most {MAX_MEMBERS} members")

    group = models.Group(name=name, created_by=current_user.id)
    db.add(group)
    db.flush()

    db.add(models.GroupMember(group_id=group.id, user_id=current_user.id, is_admin=True))
    for uid in valid_ids:
        db.add(models.GroupMember(group_id=group.id, user_id=uid, is_admin=False))
    db.commit()
    db.refresh(group)

    await notify(valid_ids, group.id)
    return group_summary(group, db, current_user.id)


@router.get("/{group_id}")
def get_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    group, _ = require_group(db, group_id, current_user.id)

    rows = (
        db.query(models.GroupMember.user_id, models.User.username, models.GroupMember.is_admin)
        .join(models.User, models.User.id == models.GroupMember.user_id)
        .filter(models.GroupMember.group_id == group_id)
        .order_by(models.GroupMember.is_admin.desc(), models.User.username)
        .all()
    )

    data = group_summary(group, db, current_user.id)
    data["members"] = [
        {"id": r[0], "username": r[1], "is_admin": bool(r[2])} for r in rows
    ]
    return data


@router.put("/{group_id}")
async def rename_group(
    group_id: int,
    payload: GroupRename,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    group, _ = require_group(db, group_id, current_user.id, admin=True)
    group.name = clean_name(payload.name)
    db.commit()

    await notify(member_ids_of(db, group_id), group_id)
    return {"ok": True, "name": group.name}


@router.post("/{group_id}/members")
async def add_members(
    group_id: int,
    payload: MembersAdd,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    require_group(db, group_id, current_user.id, admin=True)

    existing = set(member_ids_of(db, group_id))
    wanted = set(payload.user_ids) - existing
    valid_ids = []
    if wanted:
        rows = (
            db.query(models.User.id)
            .filter(models.User.id.in_(wanted), models.User.is_active.is_(True))
            .all()
        )
        valid_ids = [r[0] for r in rows]

    if len(existing) + len(valid_ids) > MAX_MEMBERS:
        raise HTTPException(status_code=400, detail=f"A group can have at most {MAX_MEMBERS} members")

    for uid in valid_ids:
        db.add(models.GroupMember(group_id=group_id, user_id=uid, is_admin=False))
    db.commit()

    await notify(list(existing) + valid_ids, group_id)
    return {"ok": True, "added": len(valid_ids)}


@router.delete("/{group_id}/members/{user_id}")
async def remove_member(
    group_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    group, me = require_group(db, group_id, current_user.id)

    # Anyone can leave; only admins can remove other people
    if user_id != current_user.id and not me.is_admin:
        raise HTTPException(status_code=403, detail="Only group admins can remove members")

    target = get_membership(db, group_id, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="That person is not in the group")

    everyone = member_ids_of(db, group_id)
    was_admin = bool(target.is_admin)
    db.delete(target)
    db.commit()

    remaining = member_ids_of(db, group_id)
    if not remaining:
        # The last person left: delete the group and its messages
        db.query(models.GroupMessage).filter(models.GroupMessage.group_id == group_id).delete()
        db.delete(group)
        db.commit()
    elif was_admin:
        has_admin = (
            db.query(models.GroupMember)
            .filter(models.GroupMember.group_id == group_id, models.GroupMember.is_admin.is_(True))
            .first()
        )
        if not has_admin:
            oldest = (
                db.query(models.GroupMember)
                .filter(models.GroupMember.group_id == group_id)
                .order_by(models.GroupMember.joined_at, models.GroupMember.id)
                .first()
            )
            oldest.is_admin = True
            db.commit()

    await notify(everyone, group_id)
    return {"ok": True}


@router.get("/{group_id}/messages")
def group_messages(
    group_id: int,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    require_group(db, group_id, current_user.id)
    limit = max(1, min(limit, 200))

    rows = (
        db.query(models.GroupMessage)
        .filter(models.GroupMessage.group_id == group_id)
        .order_by(models.GroupMessage.timestamp.desc(), models.GroupMessage.id.desc())
        .limit(limit)
        .all()
    )
    rows.reverse()
    return [serialize_group_message(m, db) for m in rows]