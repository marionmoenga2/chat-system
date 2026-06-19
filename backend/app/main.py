"""
Main FastAPI application entry point.
"""
import os
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import json

from app.database import engine, Base, get_db
from app import auth, crud, schemas
from app.websocket_manager import manager
from app.routers import auth as auth_router, users, messages, admin

Base.metadata.create_all(bind=engine)
auth.SECRET_KEY = os.getenv("SECRET_KEY", "change-this-in-production")

app = FastAPI(
    title="Chat System API",
    description="Real-time chat system with FastAPI and WebSockets",
    version="1.0.0"
)

# CORS - allow all origins for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,  # Must be False when origins=["*"]
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(users.router)
app.include_router(messages.router)
app.include_router(admin.router)

@app.websocket("/ws/{token}")
async def websocket_endpoint(websocket: WebSocket, token: str, db: Session = Depends(get_db)):
    try:
        payload = auth.jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        user_id = int(payload.get("sub"))
        user = crud.get_user_by_id(db, user_id)
        
        if not user or not user.is_active:
            await websocket.close(code=4001)
            return
    except Exception:
        await websocket.close(code=4001)
        return
    
    await manager.connect(websocket, user_id)
    
    await manager.broadcast({
        "type": "user_status",
        "user_id": user_id,
        "username": user.username,
        "status": "online"
    })
    
    try:
        while True:
            data = await websocket.receive_text()
            message_data = json.loads(data)
            
            msg_type = message_data.get("type", "private")
            content = message_data.get("content", "")
            receiver_id = message_data.get("receiver_id")
            
            if msg_type == "private" and receiver_id:
                db_message = crud.create_message(
                    db, 
                    sender_id=user_id, 
                    receiver_id=receiver_id, 
                    content=content
                )
                
                message_payload = {
                    "type": "message",
                    "id": db_message.id,
                    "sender_id": user_id,
                    "sender_username": user.username,
                    "receiver_id": receiver_id,
                    "content": content,
                    "timestamp": db_message.timestamp.isoformat()
                }
                
                await manager.send_personal_message(message_payload, receiver_id)
                await manager.send_personal_message(message_payload, user_id)
            
            elif msg_type == "typing":
                await manager.send_personal_message({
                    "type": "typing",
                    "user_id": user_id,
                    "username": user.username
                }, receiver_id)
                
    except WebSocketDisconnect:
        manager.disconnect(user_id)
        await manager.broadcast({
            "type": "user_status",
            "user_id": user_id,
            "username": user.username,
            "status": "offline"
        })

@app.get("/")
def read_root():
    return {"message": "Chat System API is running", "docs": "/docs"}
