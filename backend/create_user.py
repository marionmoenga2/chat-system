"""
Create a user from the command line.
Run it inside the backend folder with DATABASE_URL set (see the instructions):
    python3 create_user.py
"""
import getpass
import re

from app.database import SessionLocal
from app import crud, models


def main():
    username = input("Username: ").strip()
    email = input("Email: ").strip()
    password = getpass.getpass("Password (hidden): ")
    repeat = getpass.getpass("Repeat password: ")
    make_admin = input("Make this person an admin? (y/N): ").strip().lower() == "y"

    if not re.match(r"^[A-Za-z0-9_.-]{3,50}$", username):
        print("Username must be 3 to 50 characters: letters, numbers, dots, dashes or underscores.")
        return
    if "@" not in email or "." not in email.split("@")[-1]:
        print("That does not look like an email address.")
        return
    if len(password) < 8 or len(password) > 72:
        print("The password must be 8 to 72 characters.")
        return
    if password != repeat:
        print("The two passwords do not match.")
        return

    with SessionLocal() as db:
        if crud.get_user_by_username(db, username=username):
            print("That username is already taken.")
            return
        if crud.get_user_by_email(db, email=email):
            print("That email is already registered.")
            return

        user = crud.create_user(db, username=username, email=email, password=password)
        user.is_admin = make_admin
        if hasattr(models.User, "is_approved"):
            user.is_approved = True
        db.commit()
        print("Created %s (id %s)%s" % (username, user.id, " as an admin" if make_admin else ""))


if __name__ == "__main__":
    main()