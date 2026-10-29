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


def ensure_approval_column():
    """Add users.is_approved to an existing database (create_all only creates new tables).
    Everyone who already has an account is marked approved."""
    from sqlalchemy import inspect, text
    insp = inspect(engine)
    if "users" not in insp.get_table_names():
        return
    if "is_approved" in [c["name"] for c in insp.get_columns("users")]:
        return
    default = "1" if engine.url.get_backend_name() == "sqlite" else "TRUE"
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE users ADD COLUMN is_approved BOOLEAN NOT NULL DEFAULT " + default))
    print("Migration: added users.is_approved (existing users stay approved)")
