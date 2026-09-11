"""
Synchronize and enforce Default Admin Credentials across the entire Multi-ERP Platform.

Enforces:
- Email: admin@example.com
- Username: admin
- Password: ChangeMe!12345
- Role: super_admin / SUPER_ADMIN
- must_change_password: False
- is_active: True, status: ACTIVE
- Missing schema columns (e.g. user_permissions.is_granted) reconciled
"""

import asyncio
import uuid
from datetime import datetime, timezone
import asyncpg
from argon2 import PasswordHasher

hasher = PasswordHasher()
TARGET_EMAIL = "admin@example.com"
TARGET_USERNAME = "admin"
TARGET_PASSWORD = "ChangeMe!12345"
TARGET_PASSWORD_HASH = hasher.hash(TARGET_PASSWORD)

from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent.parent

def load_env_db_url(env_file_path: Path) -> str:
    if not env_file_path.exists():
        return ""
    for line in env_file_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("DATABASE_URL="):
            val = line.split("=", 1)[1].strip().strip('"').strip("'")
            return val.replace("postgresql+asyncpg://", "postgresql://")
    return ""

DATABASES = {
    "ERP_Main": load_env_db_url(BASE_DIR / "ERP_Main" / "backend" / ".env"),
    "Yinglima_ERP": load_env_db_url(BASE_DIR / "Yinglima_ERP" / "backend" / ".env"),
    "Inhyma_ERP": load_env_db_url(BASE_DIR / "Inhyma_ERP" / "backend" / ".env"),
}

async def sync_erp_main(conn: asyncpg.Connection):
    print("\n--- Syncing ERP_Main ---")
    now = datetime.now(timezone.utc)
    
    # 1. platform_admins
    admin = await conn.fetchrow("SELECT * FROM platform_admins WHERE email = $1", TARGET_EMAIL)
    if admin is None:
        admin_id = uuid.uuid4()
        await conn.execute("""
            INSERT INTO platform_admins (id, email, display_name, password_hash, role, is_active, created_at, updated_at)
            VALUES ($1, $2, $3, $4, 'SUPER_ADMIN', true, $5, $5)
        """, admin_id, TARGET_EMAIL, "Platform Super Admin", TARGET_PASSWORD_HASH, now)
        print("  [ERP_Main] Created platform_admin:", TARGET_EMAIL)
    else:
        await conn.execute("""
            UPDATE platform_admins 
            SET password_hash = $1, role = 'SUPER_ADMIN', is_active = true, updated_at = $2
            WHERE email = $3
        """, TARGET_PASSWORD_HASH, now, TARGET_EMAIL)
        print("  [ERP_Main] Updated platform_admin password & role for:", TARGET_EMAIL)

    # 2. global_users
    g_user = await conn.fetchrow("SELECT * FROM global_users WHERE primary_email = $1", TARGET_EMAIL)
    if g_user is None:
        g_user_id = uuid.uuid4()
        await conn.execute("""
            INSERT INTO global_users (id, primary_email, display_name, status, created_at, updated_at)
            VALUES ($1, $2, $3, 'ACTIVE', $4, $4)
        """, g_user_id, TARGET_EMAIL, "Platform Super Admin", now)
        print("  [ERP_Main] Created global_user:", TARGET_EMAIL)
    else:
        g_user_id = g_user["id"]
        await conn.execute("""
            UPDATE global_users SET status = 'ACTIVE', updated_at = $1 WHERE id = $2
        """, now, g_user_id)
        print("  [ERP_Main] Ensured global_user is ACTIVE:", TARGET_EMAIL)

    # 3. global_user_credentials
    cred = await conn.fetchrow("SELECT * FROM global_user_credentials WHERE global_user_id = $1", g_user_id)
    if cred is None:
        await conn.execute("""
            INSERT INTO global_user_credentials (id, global_user_id, password_hash, must_change_password, failed_login_count, locked_until, created_at, updated_at)
            VALUES ($1, $2, $3, false, 0, NULL, $4, $4)
        """, uuid.uuid4(), g_user_id, TARGET_PASSWORD_HASH, now)
        print("  [ERP_Main] Created global_user_credential for:", TARGET_EMAIL)
    else:
        await conn.execute("""
            UPDATE global_user_credentials 
            SET password_hash = $1, must_change_password = false, failed_login_count = 0, locked_until = NULL, updated_at = $2
            WHERE global_user_id = $3
        """, TARGET_PASSWORD_HASH, now, g_user_id)
        print("  [ERP_Main] Updated global_user_credential for:", TARGET_EMAIL)


async def sync_tenant_erp(name: str, conn: asyncpg.Connection):
    print(f"\n--- Syncing {name} ---")
    now = datetime.now(timezone.utc)
    
    # 1. Ensure user_permissions has is_granted column
    cols = await conn.fetch("SELECT column_name FROM information_schema.columns WHERE table_name = 'user_permissions'")
    col_names = [c["column_name"] for c in cols]
    if "is_granted" not in col_names:
        print(f"  [{name}] Adding missing 'is_granted' column to user_permissions...")
        await conn.execute("ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS is_granted BOOLEAN NOT NULL DEFAULT TRUE;")
        print(f"  [{name}] Column 'is_granted' added successfully.")
    else:
        print(f"  [{name}] 'user_permissions.is_granted' already exists.")

    # 2. Ensure super_admin role exists
    role = await conn.fetchrow("SELECT id, name FROM roles WHERE name = 'super_admin'")
    if role is None:
        role_id = uuid.uuid4()
        await conn.execute("""
            INSERT INTO roles (id, name, description, is_system, created_at, updated_at)
            VALUES ($1, 'super_admin', 'Full system access', true, $2, $2)
        """, role_id, now)
        print(f"  [{name}] Created super_admin role.")
    else:
        role_id = role["id"]
        # Ensure role is un-deleted
        await conn.execute("UPDATE roles SET deleted_at = NULL WHERE id = $1", role_id)
        print(f"  [{name}] Found super_admin role: {role_id}")

    # 3. Ensure role_permissions carries all permissions for super_admin
    perms = await conn.fetch("SELECT id FROM permissions")
    existing_rps = await conn.fetch("SELECT permission_id FROM role_permissions WHERE role_id = $1", role_id)
    existing_perm_ids = {r["permission_id"] for r in existing_rps}
    missing_perm_ids = [p["id"] for p in perms if p["id"] not in existing_perm_ids]
    if missing_perm_ids:
        print(f"  [{name}] Linking {len(missing_perm_ids)} missing permissions to super_admin...")
        for pid in missing_perm_ids:
            await conn.execute("""
                INSERT INTO role_permissions (id, role_id, permission_id, created_at)
                VALUES ($1, $2, $3, $4)
            """, uuid.uuid4(), role_id, pid, now)
        print(f"  [{name}] All permissions linked to super_admin.")
    else:
        print(f"  [{name}] super_admin has all {len(perms)} permissions.")

    # 4. Lookup or create admin user
    user = await conn.fetchrow("SELECT * FROM users WHERE email = $1 OR username = $2", TARGET_EMAIL, TARGET_USERNAME)
    if user is None:
        user_id = uuid.uuid4()
        await conn.execute("""
            INSERT INTO users (
                id, username, email, password_hash, status, is_active, 
                must_change_password, failed_login_count, locked_until, has_login, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, 'ACTIVE', true, false, 0, NULL, true, $5, $5)
        """, user_id, TARGET_USERNAME, TARGET_EMAIL, TARGET_PASSWORD_HASH, now)
        print(f"  [{name}] Created admin user: {TARGET_EMAIL}")
    else:
        user_id = user["id"]
        await conn.execute("""
            UPDATE users 
            SET email = $1, username = $2, password_hash = $3, status = 'ACTIVE', 
                is_active = true, must_change_password = false, failed_login_count = 0, 
                locked_until = NULL, has_login = true, deleted_at = NULL, updated_at = $4
            WHERE id = $5
        """, TARGET_EMAIL, TARGET_USERNAME, TARGET_PASSWORD_HASH, now, user_id)
        print(f"  [{name}] Updated admin user {TARGET_EMAIL} password, status, and unlocked.")

    # 5. Link super_admin in user_roles
    ur_cols = await conn.fetch("SELECT column_name FROM information_schema.columns WHERE table_name = 'user_roles'")
    ur_col_names = [c["column_name"] for c in ur_cols]
    
    ur = await conn.fetchrow("SELECT * FROM user_roles WHERE user_id = $1 AND role_id = $2", user_id, role_id)
    if ur is None:
        ur_id = uuid.uuid4()
        if "assignment_type" in ur_col_names:
            await conn.execute("""
                INSERT INTO user_roles (id, user_id, role_id, assigned_at, assignment_type, is_primary, status)
                VALUES ($1, $2, $3, $4, 'PRIMARY', true, 'ACTIVE')
            """, ur_id, user_id, role_id, now)
        else:
            await conn.execute("""
                INSERT INTO user_roles (id, user_id, role_id, assigned_at)
                VALUES ($1, $2, $3, $4)
            """, ur_id, user_id, role_id, now)
        print(f"  [{name}] Assigned super_admin role to user {TARGET_EMAIL}.")
    else:
        if "status" in ur_col_names:
            await conn.execute("""
                UPDATE user_roles 
                SET status = 'ACTIVE', effective_from = NULL, effective_to = NULL, is_primary = true 
                WHERE user_id = $1 AND role_id = $2
            """, user_id, role_id)
        print(f"  [{name}] Confirmed super_admin role assignment is ACTIVE for {TARGET_EMAIL}.")


async def main():
    print("==================================================================")
    print(">>> MULTI-ERP ADMIN CREDENTIAL ENFORCEMENT <<<")
    print(f"Admin Email:    {TARGET_EMAIL}")
    print(f"Admin Username: {TARGET_USERNAME}")
    print(f"Admin Password: {TARGET_PASSWORD}")
    print("==================================================================")
    
    # 1. ERP_Main
    conn_main = await asyncpg.connect(DATABASES["ERP_Main"], statement_cache_size=0)
    try:
        await sync_erp_main(conn_main)
    finally:
        await conn_main.close()

    # 2. Yinglima_ERP
    conn_yinglima = await asyncpg.connect(DATABASES["Yinglima_ERP"], statement_cache_size=0)
    try:
        await sync_tenant_erp("Yinglima_ERP", conn_yinglima)
    finally:
        await conn_yinglima.close()

    # 3. Inhyma_ERP
    conn_inhyma = await asyncpg.connect(DATABASES["Inhyma_ERP"], statement_cache_size=0)
    try:
        await sync_tenant_erp("Inhyma_ERP", conn_inhyma)
    finally:
        await conn_inhyma.close()

    print("\n[COMPLETE] All three ERP databases successfully configured with matching Admin credentials!")

if __name__ == "__main__":
    asyncio.run(main())
