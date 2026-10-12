"""
Secrets saved from the admin panel (for example the AI assistant key).
Values are cached in memory and never returned to the browser in full.
"""
from app.database import SessionLocal
from app import models

_cache = {}


def _clean(value):
    return (value or "").strip().strip(chr(34) + chr(39)).strip()


def get(name):
    if name not in _cache:
        with SessionLocal() as db:
            row = db.get(models.AppSecret, name)
            _cache[name] = _clean(row.value) if row else ""
    return _cache[name]


def save(name, value):
    value = _clean(value)
    with SessionLocal() as db:
        row = db.get(models.AppSecret, name)
        if row:
            row.value = value
        else:
            db.add(models.AppSecret(key=name, value=value))
        db.commit()
    _cache[name] = value


def remove(name):
    with SessionLocal() as db:
        row = db.get(models.AppSecret, name)
        if row:
            db.delete(row)
            db.commit()
    _cache[name] = ""
