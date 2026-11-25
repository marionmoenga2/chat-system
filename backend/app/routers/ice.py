"""ICE servers for voice/video calls: STUN always, TURN when configured in the environment."""
import os
from fastapi import APIRouter, Depends
from app import auth

router = APIRouter(prefix="/api/calls", tags=["Calls"])


@router.get("/ice")
def ice_servers(current_user = Depends(auth.get_current_user)):
    servers = [
        {"urls": "stun:stun.l.google.com:19302"},
        {"urls": "stun:stun1.l.google.com:19302"},
    ]
    urls = [u.strip() for u in os.getenv("TURN_URLS", "").split(",") if u.strip()]
    username = os.getenv("TURN_USERNAME", "").strip()
    credential = os.getenv("TURN_CREDENTIAL", "").strip()
    has_turn = bool(urls and username and credential)
    if has_turn:
        servers.append({"urls": urls, "username": username, "credential": credential})
    return {"iceServers": servers, "turn": has_turn}
