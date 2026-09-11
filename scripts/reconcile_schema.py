"""
Reconcile and ensure complete schema parity across all ERP databases.
"""

import asyncio
import asyncpg
from pathlib import Path

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

RECONCILIATION_STATEMENTS = [
    # 1. OCC Version columns
    "ALTER TABLE units_of_measurement ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;",
    "ALTER TABLE hsn_codes ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;",
    "ALTER TABLE consignment_codes ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;",
    "ALTER TABLE inquiry_items ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;",
    "ALTER TABLE master_companies ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;",
    "ALTER TABLE supplier_types ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;",
    "ALTER TABLE buyer_types ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;",

    # 2. Branch ID columns
    "ALTER TABLE consignment_codes ADD COLUMN IF NOT EXISTS branch_id VARCHAR(100);",
    "ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS branch_id VARCHAR(100);",

    # 3. Planning enhancements
    "ALTER TABLE planning_sheets ADD COLUMN IF NOT EXISTS item_description TEXT;",
    "ALTER TABLE planning_columns ADD COLUMN IF NOT EXISTS description TEXT;",

    # 4. User permissions
    "ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS is_granted BOOLEAN NOT NULL DEFAULT TRUE;",

    # 5. Inquiry Messages table
    """
    CREATE TABLE IF NOT EXISTS inquiry_messages (
        id UUID PRIMARY KEY,
        inquiry_id UUID NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
        inquiry_item_id UUID REFERENCES inquiry_items(id) ON DELETE SET NULL,
        supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
        channel VARCHAR(30) NOT NULL DEFAULT 'wechat',
        direction VARCHAR(20) NOT NULL DEFAULT 'inbound',
        sender_name VARCHAR(100),
        sender_contact VARCHAR(100),
        recipient_contact VARCHAR(100),
        message_text TEXT NOT NULL,
        attachment_url VARCHAR(500),
        attachment_filename VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMP WITH TIME ZONE
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_inquiry_messages_inquiry_id ON inquiry_messages (inquiry_id);",
    "CREATE INDEX IF NOT EXISTS ix_inquiry_messages_channel ON inquiry_messages (channel);",
    "CREATE INDEX IF NOT EXISTS ix_inquiry_messages_direction ON inquiry_messages (direction);",
]

async def apply_reconciliation(name: str, url: str):
    print(f"\n--- Reconciling Schema for {name} ---")
    conn = await asyncpg.connect(url, statement_cache_size=0)
    try:
        for stmt in RECONCILIATION_STATEMENTS:
            await conn.execute(stmt)
        print(f"  [SUCCESS] All reconciliation DDL applied for {name}.")
    finally:
        await conn.close()

async def main():
    inhyma_url = load_env_db_url(BASE_DIR / "Inhyma_ERP" / "backend" / ".env")
    yinglima_url = load_env_db_url(BASE_DIR / "Yinglima_ERP" / "backend" / ".env")

    await apply_reconciliation("Inhyma_ERP", inhyma_url)
    await apply_reconciliation("Yinglima_ERP", yinglima_url)
    print("\n[COMPLETE] Multi-ERP Schema Reconciliation Complete!")

if __name__ == "__main__":
    asyncio.run(main())
