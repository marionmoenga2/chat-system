"""
Group call rooms. The server only tracks who is in a call and who is invited;
audio/video flows directly between browsers (mesh WebRTC).
"""
from typing import Dict, Set
from app.websocket_manager import manager

MAX_PARTICIPANTS = 6  # mesh gets heavy beyond ~4-6 people
GROUP_CALL_TYPES = {"call_start", "call_invite", "call_join", "call_decline", "call_leave"}


class CallRoom:
    def __init__(self, call_id: str, host_id: int, video: bool):
        self.call_id = call_id
        self.host_id = host_id
        self.video = video
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
        for v in value[:10]:
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
            {"type": "call_unavailable", "from_id": target_id, "call_id": room.call_id},
            inviter_id,
        )
        return
    if len(room.members) + len(room.invited) >= MAX_PARTICIPANTS:
        await manager.send_personal_message(
            {"type": "call_full", "call_id": room.call_id}, inviter_id
        )
        return
    room.invited.add(target_id)
    await manager.send_personal_message({
        "type": "call_invite",
        "call_id": room.call_id,
        "from_id": inviter_id,
        "from_username": inviter_name,
        "video": room.video,
        "participants": _members_list(room),
    }, target_id)


async def _close_room(room: CallRoom):
    rooms.pop(room.call_id, None)
    for uid in list(room.members) + list(room.invited):
        await manager.send_personal_message(
            {"type": "call_ended", "call_id": room.call_id}, uid
        )


async def leave(user_id: int, call_id: str):
    room = rooms.get(call_id)
    if not room:
        return
    room.invited.discard(user_id)
    if user_id in room.members:
        del room.members[user_id]
        await _send_to_members(room, {
            "type": "call_participant_left", "call_id": call_id, "user_id": user_id
        })
    # A call with nobody left to talk to (and nobody pending) is over
    if len(room.members) <= 1 and not room.invited:
        await _close_room(room)


async def leave_all(user_id: int):
    """Call this when a user's WebSocket disconnects."""
    for call_id in [cid for cid, r in rooms.items()
                    if user_id in r.members or user_id in r.invited]:
        await leave(user_id, call_id)


async def handle(user_id: int, username: str, msg_type: str, data: dict):
    call_id = str(data.get("call_id") or "")[:64]
    if not call_id:
        return

    if msg_type == "call_start":
        if call_id in rooms:
            return
        room = CallRoom(call_id, user_id, bool(data.get("video")))
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
        if user_id not in room.members:      # only people in the call can add others
            return
        for target in _ids(data.get("invite_ids")):
            await _invite(room, user_id, username, target)

    elif msg_type == "call_join":
        if user_id not in room.invited:      # must have been invited
            return
        existing = _members_list(room)
        room.invited.discard(user_id)
        room.members[user_id] = username
        # Tell the newcomer who is already there; they send an offer to each of them
        await manager.send_personal_message(
            {"type": "call_joined", "call_id": call_id, "participants": existing}, user_id
        )
        # Tell everyone else to expect an offer from the newcomer
        await _send_to_members(room, {
            "type": "call_participant_joined",
            "call_id": call_id, "user_id": user_id, "username": username,
        }, exclude=user_id)

    elif msg_type == "call_decline":
        if user_id in room.invited:
            await leave(user_id, call_id)
            await _send_to_members(room, {
                "type": "call_declined", "call_id": call_id, "user_id": user_id
            })

    elif msg_type == "call_leave":
        await leave(user_id, call_id)