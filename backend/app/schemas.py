"""
Pydantic models for request/response validation and serialization.
"""
import re
from pydantic import BaseModel, EmailStr, field_validator
from datetime import datetime
from typing import Optional, List

# --- User Schemas ---
class UserBase(BaseModel):
    username: str
    email: EmailStr

class UserCreate(UserBase):
    password: str
    phone: str

    @field_validator("phone")
    @classmethod
    def clean_phone(cls, v):
        digits = re.sub(r"[\s\-().]", "", v or "")
        if not re.fullmatch(r"\+[1-9]\d{7,14}", digits):
            raise ValueError("Enter a valid phone number with country code, e.g. +254712345678")
        return digits

class UserResponse(UserBase):
    id: int
    is_admin: bool
    is_active: bool
    created_at: datetime
    
    class Config:
        from_attributes = True

class UserLogin(BaseModel):
    username: str
    password: str

# --- Message Schemas ---
class MessageBase(BaseModel):
    content: str
    receiver_id: int

class MessageCreate(MessageBase):
    pass

class MessageResponse(BaseModel):
    id: int
    sender_id: int
    receiver_id: int
    content: str
    timestamp: datetime
    read_status: bool
    sender_username: Optional[str] = None
    
    class Config:
        from_attributes = True

# --- Token Schemas ---
class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse

# --- WebSocket Message Schema ---
class WebSocketMessage(BaseModel):
    type: str  # "private", "broadcast", "typing"
    receiver_id: Optional[int] = None
    content: str


class AdminUserResponse(UserResponse):
    """Only returned by admin routes. Includes the private phone number."""
    phone: Optional[str] = None
