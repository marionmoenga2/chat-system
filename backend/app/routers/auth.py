"""
Authentication endpoints: Signup and Login.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app import crud, schemas, auth as auth_utils

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

@router.post("/signup", response_model=schemas.UserResponse)
def signup(user: schemas.UserCreate, db: Session = Depends(get_db)):
    """
    Register a new user.
    Checks for existing username/email before creating.
    """
    # Check if username exists
    db_user = crud.get_user_by_username(db, username=user.username)
    if db_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered"
        )
    
    # Check if email exists
    db_user = crud.get_user_by_email(db, email=user.email)
    if db_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Create new user
    return crud.create_user(db, username=user.username, email=user.email, password=user.password)

@router.post("/login", response_model=schemas.Token)
def login(credentials: schemas.UserLogin, db: Session = Depends(get_db)):
    """
    Authenticate user and return JWT token.
    """
    user = crud.get_user_by_username(db, username=credentials.username)
    if not user or not auth_utils.verify_password(credentials.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password"
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account has been banned"
        )
    
    access_token = auth_utils.create_access_token(data={"sub": str(user.id)})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": user
    }

@router.get("/me", response_model=schemas.UserResponse)
def get_current_user_info(current_user = Depends(auth_utils.get_current_user)):
    """Get information about the currently logged-in user."""
    return current_user