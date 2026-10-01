import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Read the database URL from the environment (set in Render).
# Falls back to local SQLite so it still works on your own machine.
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./chat_system.db")

# Some providers hand out postgres://, which SQLAlchemy rejects
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,   # Neon suspends idle connections; this reconnects cleanly
        pool_recycle=300,
        pool_size=5,
        max_overflow=5,
    )

# Shows in the Render logs so you can confirm which database is in use
print("Database backend:", engine.url.get_backend_name())

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()