"""
Standalone Bootstrap Admin Diagnostic.

Reports the exact reason `admin@example.com` cannot log in, without
ever changing the password -- run this instead of guessing.

Usage (from this ERP's backend/ folder):
    python scripts/Yinglima_diagnose_admin.py

Add --reset-password to ALSO reset the password back to
BOOTSTRAP_ADMIN_PASSWORD (from .env) if you genuinely want that:
    python scripts/Yinglima_diagnose_admin.py --reset-password
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

# Ensure backend root is on sys.path so 'app' can always be imported
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.auth.security import hash_password, verify_password
from app.core.config import settings
from app.database.engine import dispose_engine, get_sessionmaker
from app.users.models import UserStatus
from app.users.repository import UserRepository


async def main(reset_password: bool) -> None:
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        repo = UserRepository(session)
        admin = await repo.get_by_username(settings.BOOTSTRAP_ADMIN_USERNAME)
        if admin is None:
            admin = await repo.get_by_email(settings.BOOTSTRAP_ADMIN_EMAIL)

        print("=" * 70)
        if admin is None:
            print(f"NO admin row found for username={settings.BOOTSTRAP_ADMIN_USERNAME!r} "
                  f"or email={settings.BOOTSTRAP_ADMIN_EMAIL!r}.")
            print("Run `python scripts/seed.py` to create it.")
            print("=" * 70)
            return

        print(f"Admin row FOUND: id={admin.id}")
        print(f"  username:            {admin.username!r}")
        print(f"  email:               {admin.email!r}")
        print(f"  has_login:           {admin.has_login}")
        print(f"  is_active:           {admin.is_active}")
        print(f"  status:              {admin.status.value if admin.status else None}")
        print(f"  deleted_at:          {admin.deleted_at}")
        print(f"  locked_until:        {admin.locked_until}")
        print(f"  is_locked (now):     {admin.is_locked}")
        print(f"  failed_login_count:  {admin.failed_login_count}")
        print(f"  password_hash set:   {admin.password_hash is not None}")

        if admin.password_hash is not None:
            matches = verify_password(settings.BOOTSTRAP_ADMIN_PASSWORD, admin.password_hash)
            print(f"  password matches BOOTSTRAP_ADMIN_PASSWORD in .env ({settings.BOOTSTRAP_ADMIN_PASSWORD!r})? "
                  f"{matches}")
            if not matches and not reset_password:
                print()
                print("  ^ THIS is almost certainly why login fails: the stored password does")
                print("    NOT match what .env says it should be (someone changed it, or it was")
                print("    seeded with a different value at some point). Re-run this script with")
                print("    --reset-password if you want it set back to the .env value.")

        blocking = []
        if admin.deleted_at is not None:
            blocking.append("soft-deleted (deleted_at is set)")
        if not admin.has_login:
            blocking.append("has_login is False")
        if admin.is_locked:
            blocking.append(f"temporarily locked until {admin.locked_until}")
        if admin.status == UserStatus.LOCKED:
            blocking.append("status is LOCKED")
        if not admin.is_active:
            blocking.append("is_active is False")
        if admin.password_hash is None:
            blocking.append("password_hash is NULL (no password set at all)")

        print()
        if blocking:
            print("BLOCKING CONDITIONS FOUND:")
            for reason in blocking:
                print(f"  - {reason}")
            print()
            print("Note: the running server's own startup check now auto-repairs the")
            print("account-state issues above (soft-delete, has_login, lock, is_active)")
            print("on its next restart. It never touches the password by itself.")
        else:
            print("No account-state blocking conditions found.")

        if reset_password:
            admin.password_hash = hash_password(settings.BOOTSTRAP_ADMIN_PASSWORD)
            admin.must_change_password = False
            await session.commit()
            print()
            print(f"Password RESET to the value in .env ({settings.BOOTSTRAP_ADMIN_PASSWORD!r}).")

        print("=" * 70)

    await dispose_engine()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Diagnose why the bootstrap admin can't log in.")
    parser.add_argument(
        "--reset-password",
        action="store_true",
        help="Also reset the password to BOOTSTRAP_ADMIN_PASSWORD from .env.",
    )
    args = parser.parse_args()
    asyncio.run(main(reset_password=args.reset_password))