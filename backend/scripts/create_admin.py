"""Buat / reset akun admin dashboard.

    python -m scripts.create_admin admin
"""

import argparse
import getpass

from sqlalchemy import select

from app.db import SessionLocal, init_db
from app.models import AdminUser
from app.security import hash_password


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("username")
    parser.add_argument("--password", help="Jika kosong, akan ditanyakan")
    args = parser.parse_args()
    password = args.password or getpass.getpass("Password baru: ")
    if len(password) < 10:
        raise SystemExit("Password minimal 10 karakter")
    init_db()
    with SessionLocal() as db:
        user = db.scalar(select(AdminUser).where(AdminUser.username == args.username))
        if user is None:
            user = AdminUser(username=args.username, password_hash="")
            db.add(user)
        user.password_hash = hash_password(password)
        user.is_active = True
        db.commit()
    print(f"Admin '{args.username}' siap dipakai.")


if __name__ == "__main__":
    main()
