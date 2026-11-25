"""
Photos and files sent in private chats and groups.
Stored in the database like voice notes. Only the sender, the receiver (or the group's
members, or an admin) can open one, and attachments older than 30 days are deleted.
"""
import base64
import binascii
import re
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, undefer

from app.database import get_db
from app import auth, models

router = APIRouter(prefix="/api/files", tags=["Photos and files"])

MAX_IMAGE_BYTES = 800_000
MAX_FILE_BYTES = 3_000_000
KEEP_DAYS = 30
MAX_PER_10_MIN = 15

IMAGE_TYPES = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif"}
FILE_TYPES = {
    "pdf": "application/pdf", "txt": "text/plain", "csv": "text/csv", "rtf": "application/rtf",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "ppt": "application/vnd.ms-powerpoint",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "odt": "application/vnd.oasis.opendocument.text",
    "zip": "application/zip",
}


class FileUpload(BaseModel):
    data: str                       # base64, without any "data:" prefix
    name: str
    to_user_id: Optional[int] = None
    group_id: Optional[int] = None


def _is_member(db: Session, group_id: int, user_id: int) -> bool:
    return db.query(models.GroupMember).filter(
        models.GroupMember.group_id == group_id, models.GroupMember.user_id == user_id
    ).first() is not None


def _clean_name(name: str) -> str:
    name = (name or "").replace("\\", "/").split("/")[-1]
    name = re.sub(r"[\x00-\x1f\x7f<>:\"|?*]", "", name).strip()
    return name[-80:]


def _looks_right(ext: str, raw: bytes) -> bool:
    """The first bytes of the file must match what its extension claims."""
    if ext in ("jpg", "jpeg"):
        return raw[:3] == b"\xff\xd8\xff"
    if ext == "png":
        return raw[:8] == b"\x89PNG\r\n\x1a\n"
    if ext == "gif":
        return raw[:4] == b"GIF8"
    if ext == "webp":
        return raw[:4] == b"RIFF" and raw[8:12] == b"WEBP"
    if ext == "pdf":
        return raw[:4] == b"%PDF"
    if ext in ("docx", "xlsx", "pptx", "odt", "zip"):
        return raw[:2] == b"PK"
    if ext in ("doc", "xls", "ppt"):
        return raw[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
    return True


@router.post("")
def upload(body: FileUpload, db: Session = Depends(get_db), me=Depends(auth.get_current_user)):
    if bool(body.to_user_id) == bool(body.group_id):
        raise HTTPException(status_code=400, detail="Choose one person or one group")

    name = _clean_name(body.name)
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    mime = IMAGE_TYPES.get(ext) or FILE_TYPES.get(ext)
    if not mime:
        raise HTTPException(
            status_code=400,
            detail="This file type is not allowed. You can send photos, PDFs, Office documents, text files and zip files.",
        )
    kind = "image" if ext in IMAGE_TYPES else "file"

    try:
        raw = base64.b64decode(body.data, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="The file could not be read")
    limit = MAX_IMAGE_BYTES if kind == "image" else MAX_FILE_BYTES
    if not raw:
        raise HTTPException(status_code=400, detail="The file is empty")
    if len(raw) > limit:
        raise HTTPException(status_code=413, detail="That file is too big. The limit is %d MB." % (limit // 1_000_000 or 1))
    if not _looks_right(ext, raw):
        raise HTTPException(status_code=400, detail="This file does not look like a real ." + ext + " file")

    if body.group_id:
        if not _is_member(db, body.group_id, me.id):
            raise HTTPException(status_code=403, detail="You are not in that group")
    else:
        target = db.query(models.User).filter(
            models.User.id == body.to_user_id, models.User.is_active == True
        ).first()
        if not target or target.id == me.id:
            raise HTTPException(status_code=404, detail="That person was not found")

    now = datetime.utcnow()
    recent = db.query(func.count(models.FileAttachment.id)).filter(
        models.FileAttachment.user_id == me.id, models.FileAttachment.created_at >= now - timedelta(minutes=10)
    ).scalar()
    if (recent or 0) >= MAX_PER_10_MIN:
        raise HTTPException(status_code=429, detail="You are sending files too quickly. Please wait a few minutes.")

    db.query(models.FileAttachment).filter(
        models.FileAttachment.created_at < now - timedelta(days=KEEP_DAYS)
    ).delete(synchronize_session=False)

    item = models.FileAttachment(
        user_id=me.id, to_user_id=body.to_user_id or None, group_id=body.group_id or None,
        name=name, mime=mime, kind=kind, size=len(raw), data=raw,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"id": item.id, "kind": item.kind, "size": item.size, "name": item.name}


@router.get("/{file_id}")
def fetch(file_id: int, db: Session = Depends(get_db), me=Depends(auth.get_current_user)):
    f = db.query(models.FileAttachment).options(undefer(models.FileAttachment.data)).filter(
        models.FileAttachment.id == file_id
    ).first()
    allowed = bool(f) and (
        me.id == f.user_id
        or me.id == f.to_user_id
        or bool(getattr(me, "is_admin", False))
        or (f.group_id is not None and _is_member(db, f.group_id, me.id))
    )
    if not allowed:
        raise HTTPException(status_code=404, detail="File not found")
    disposition = "inline" if f.kind == "image" else "attachment"
    return Response(
        content=bytes(f.data),
        media_type=f.mime,
        headers={
            "Cache-Control": "private, max-age=86400",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "Content-Disposition": disposition + "; filename*=UTF-8''" + quote(f.name),
        },
    )
