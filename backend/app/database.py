"""
Database configuration and session management.
Uses SQLite for simplicity, but easily swappable with MySQL/PostgreSQL.
"""
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# SQLite database file
SQLALCHEMY_DATABASE_URL = "sqlite:///./chat_system.db"

# For MySQL, use:
# SQLALCHEMY_DATABASE_URL = "mysql+pymysql://user:password@localhost/chat_db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# Dependency to get DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()