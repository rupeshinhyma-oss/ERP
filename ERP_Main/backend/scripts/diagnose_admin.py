"""
Standalone Bootstrap Platform Admin Diagnostic.

Reports the exact reason `admin@example.com` cannot log in to ERP_Main,
without ever changing the password -- run this instead of guessing.

Usage (from ERP_Main/backend/):
    python scripts/ERP_Main_diagnose_admin.py

Add --reset-password to ALSO reset the password back to
BOOTSTRAP_ADMIN_PASSWORD (from .env) if you genuinely want that:
    python scripts/ERP_Main_diagnose_admin.py --reset-password
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

# Ensure backend root is on sys.path so 'app' can always be imported
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select

from app.core.config import settings
from app.database.engine import dispose_engine, get_sessionmaker
from app.platform_auth.models import PlatformAdmin
from app.platform_auth.security import hash_password, verify_password


async def main(reset_password: bool) -> None:
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        admin = await session.scalar(
            select(PlatformAdmin).where(PlatformAdmin.email == settings.BOOTSTRAP_ADMIN_EMAIL)
        )

        print("=" * 70)
        if admin is None:
            print(f"NO Platform Admin row found for email={settings.BOOTSTRAP_ADMIN_EMAIL!r}.")
            print("Run `python -m scripts.seed` to create it (this also seeds the ERP")
            print("registry and platform permission catalog, required on a fresh database).")
            print("=" * 70)
            return

        print(f"Platform Admin row FOUND: id={admin.id}")
        print(f"  email:        {admin.email!r}")
        print(f"  display_name: {admin.display_name!r}")
        print(f"  role:         {admin.role.value if admin.role else None}")
        print(f"  is_active:    {admin.is_active}")

        matches = verify_password(settings.BOOTSTRAP_ADMIN_PASSWORD, admin.password_hash)
        print(f"  password matches BOOTSTRAP_ADMIN_PASSWORD in .env ({settings.BOOTSTRAP_ADMIN_PASSWORD!r})? "
              f"{matches}")
        if not matches and not reset_password:
            print()
            print("  ^ THIS is almost certainly why login fails: the stored password does")
            print("    NOT match what .env says it should be (someone changed it, or it was")
            print("    seeded with a different value at some point). Re-run this script with")
            print("    --reset-password if you want it set back to the .env value.")

        if not admin.is_active:
            print()
            print("BLOCKING CONDITION: is_active is False.")
            print("Note: the running server's own startup check now auto-repairs this")
            print("(and role drift) on its next restart. It never touches the password.")

        if reset_password:
            admin.password_hash = hash_password(settings.BOOTSTRAP_ADMIN_PASSWORD)
            await session.commit()
            print()
            print(f"Password RESET to the value in .env ({settings.BOOTSTRAP_ADMIN_PASSWORD!r}).")

        print("=" * 70)

    await dispose_engine()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Diagnose why the bootstrap Platform Admin can't log in.")
    parser.add_argument(
        "--reset-password",
        action="store_true",
        help="Also reset the password to BOOTSTRAP_ADMIN_PASSWORD from .env.",
    )
    args = parser.parse_args()
    asyncio.run(main(reset_password=args.reset_password))