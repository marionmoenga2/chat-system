"""
Admin-editable settings, stored in the database and cached in memory.
"""
from app.database import SessionLocal
from app import models

DEFAULTS = {
    "maintenance_mode": "false",
    "max_call_participants": "6",
}

_cache = {}


def _ensure():
    if _cache:
        return
    with SessionLocal() as db:
        rows = {r.key: r.value for r in db.query(models.AppSetting).all()}
    _cache.update(DEFAULTS)
    _cache.update(rows)


def get_bool(key):
    _ensure()
    return _cache.get(key, DEFAULTS.get(key, "false")) == "true"


def get_int(key):
    _ensure()
    try:
        return int(_cache.get(key, DEFAULTS[key]))
    except (TypeError, ValueError):
        return int(DEFAULTS[key])


def set_values(updates):
    _ensure()
    with SessionLocal() as db:
        for key, value in updates.items():
            row = db.get(models.AppSetting, key)
            if row:
                row.value = str(value)
            else:
                db.add(models.AppSetting(key=key, value=str(value)))
        db.commit()
    _cache.update({k: str(v) for k, v in updates.items()})
