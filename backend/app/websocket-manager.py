"""
WebSocket connection manager for real-time messaging.
Handles multiple client connections and message broadcasting.
"""
from fastapi import WebSocket
from typing import Dict, List
import json

class ConnectionManager:
    def __init__(self):
        # Maps user_id -> WebSocket connection
        self.active_connections: Dict[int, WebSocket] = {}
    
    async def connect(self, websocket: WebSocket, user_id: int):
        """Accept connection and register user."""
        await websocket.accept()
        self.active_connections[user_id] = websocket
    
    def disconnect(self, user_id: int):
        """Remove user from active connections."""
        if user_id in self.active_connections:
            del self.active_connections[user_id]
    
    async def send_personal_message(self, message: dict, user_id: int):
        """Send a message to a specific user."""
        if user_id in self.active_connections:
            await self.active_connections[user_id].send_json(message)
    
    async def broadcast(self, message: dict):
        """Send a message to all connected users."""
        for connection in self.active_connections.values():
            await connection.send_json(message)
    
    def is_user_online(self, user_id: int) -> bool:
        """Check if a user is currently connected."""
        return user_id in self.active_connections
    
    def get_online_users(self) -> List[int]:
        """Return list of currently online user IDs."""
        return list(self.active_connections.keys())

# Global instance
manager = ConnectionManager()