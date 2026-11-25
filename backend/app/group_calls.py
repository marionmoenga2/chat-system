"""
Group call rooms. The server only tracks who is in a call and who is invited;
audio and video flow directly between the browsers (everyone connects to everyone).
"""
from typing import Dict, Set

from app.websocket_manager import manager

try:
    from app import settings_store
except Exception:   # the admin "settings" feature is optional
    settings_store = None

GROUP_CALL_TYPES = {"call_start", "call_invite", "call_join", "call_decline", "call_leave"}
DEFAULT_MAX = 6


def _limit() -> int:
    if settings_store is not None:
        try:
            return int(settings_store.get_int("max_call_participants"))
        except Exception:
            pass
    return DEFAULT_MAX


class CallRoom:
    def __init__(self, call_id: str, host_id: int, video: bool, title: str = ""):
        self.call_id = call_id
        self.host_id = host_id
        self.video = video
        self.title = title
        self.members: Dict[int, str] = {}   # user_id -> username
        self.invited: Set[int] = set()


rooms: Dict[str, CallRoom] = {}


def same_call(call_id: str, a: int, b: int) -> bool:
    room = rooms.get(call_id)
    return bool(room and a in room.members and b in room.members)


def _members_list(room: CallRoom):
    return [{"user_id": uid, "username": name} for uid, name in room.members.items()]


def _ids(value):
    out = []
    if isinstance(value, list):
        for v in value[:20]:
            try:
                out.append(int(v))
            except (TypeError, ValueError):
                pass
    return out


async def _send_to_members(room: CallRoom, payload: dict, exclude: int = None):
    for uid in list(room.members):
        if uid != exclude:
            await manager.send_personal_message(payload, uid)


async def _invite(room: CallRoom, inviter_id: int, inviter_name: str, target_id: int):
    if target_id in room.members or target_id == inviter_id:
        return
    if not manager.is_user_online(target_id):
        await manager.send_personal_message(
            {"type": "call_unavailable", "from_id": target_id, "call_id": room.call_id}, inviter_id
        )
        return
    limit = _limit()
    if len(room.members) + len(room.invited) >= limit:
        await manager.send_personal_message(
            {"type": "call_full", "call_id": room.call_id, "max": limit}, inviter_id
        )
        return
    room.invited.add(target_id)
    await manager.send_personal_message({
        "type": "call_invite",
        "call_id": room.call_id,
        "from_id": inviter_id,
        "from_username": inviter_name,
        "video": room.video,
        "title": room.title,
        "participants": _members_list(room),
    }, target_id)


async def _close_room(room: CallRoom):
    rooms.pop(room.call_id, None)
    for uid in list(room.members) + list(room.invited):
        await manager.send_personal_message({"type": "call_ended", "call_id": room.call_id}, uid)


async def leave(user_id: int, call_id: str):
    room = rooms.get(call_id)
    if not room:
        return
    room.invited.discard(user_id)
    if user_id in room.members:
        del room.members[user_id]
        await _send_to_members(room, {"type": "call_participant_left", "call_id": call_id, "user_id": user_id})
    if len(room.members) == 0 or (len(room.members) <= 1 and not room.invited):
        await _close_room(room)


async def leave_all(user_id: int):
    """Call this when a user's WebSocket disconnects."""
    for call_id in [cid for cid, r in rooms.items() if user_id in r.members or user_id in r.invited]:
        await leave(user_id, call_id)


async def handle(user_id: int, username: str, msg_type: str, data: dict):
    call_id = str(data.get("call_id") or "")[:64]
    if not call_id:
        return

    if msg_type == "call_start":
        if call_id in rooms:
            return
        room = CallRoom(call_id, user_id, bool(data.get("video")), str(data.get("title") or "")[:60])
        room.members[user_id] = username
        rooms[call_id] = room
        for target in _ids(data.get("invite_ids")):
            await _invite(room, user_id, username, target)
        return

    room = rooms.get(call_id)
    if not room:
        if msg_type == "call_join":
            await manager.send_personal_message({"type": "call_ended", "call_id": call_id}, user_id)
        return

    if msg_type == "call_invite":
        if user_id not in room.members:
            return
        for target in _ids(data.get("invite_ids")):
            await _invite(room, user_id, username, target)

    elif msg_type == "call_join":
        if user_id not in room.invited:
            return
        existing = _members_list(room)
        room.invited.discard(user_id)
        room.members[user_id] = username
        await manager.send_personal_message({"type": "call_joined", "call_id": call_id, "participants": existing}, user_id)
        await _send_to_members(room, {
            "type": "call_participant_joined", "call_id": call_id, "user_id": user_id, "username": username,
        }, exclude=user_id)

    elif msg_type == "call_decline":
        if user_id in room.invited:
            await _send_to_members(room, {"type": "call_declined", "call_id": call_id, "user_id": user_id})
            await leave(user_id, call_id)

    elif msg_type == "call_leave":
        await leave(user_id, call_id)
