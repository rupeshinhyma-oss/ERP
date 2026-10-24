"""create_notification_rules_and_system

Revision ID: a2b3c4d5e6f7
Revises: 9c0d1e2f3a4b
Create Date: 2026-10-17 14:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'a2b3c4d5e6f7'
down_revision = '9c0d1e2f3a4b'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Ensure planning_sheets buyer columns exist
    op.execute("ALTER TABLE planning_sheets ADD COLUMN IF NOT EXISTS buyer_id UUID REFERENCES buyers(id) ON DELETE SET NULL")
    op.execute("ALTER TABLE planning_sheets ADD COLUMN IF NOT EXISTS buyer_branch_name VARCHAR(150)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_planning_sheets_buyer_id ON planning_sheets(buyer_id)")

    # 2. notification_rules table
    op.execute("""
    CREATE TABLE IF NOT EXISTS notification_rules (
        id UUID PRIMARY KEY,
        event_key VARCHAR(100) UNIQUE NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        module VARCHAR(50) NOT NULL,
        role_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        user_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_notification_rules_event_key ON notification_rules(event_key)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_notification_rules_module ON notification_rules(module)")

    # 3. Add sender_id and module to notifications table if missing
    op.execute("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS sender_id UUID REFERENCES users(id) ON DELETE SET NULL")
    op.execute("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS module VARCHAR(50)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_notifications_sender_id ON notifications(sender_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_notifications_module ON notifications(module)")

    # 4. Seed 5 core default notification rules
    op.execute("""
    INSERT INTO notification_rules (id, event_key, title, description, module, role_ids, user_ids, is_active, created_at, updated_at)
    VALUES
    (
        'e1111111-1111-1111-1111-111111111111',
        'shipment_requirement_raised',
        'Shipment Planning: Requirement Quantity Added',
        'Triggered when India / Admin team enters or updates requirement quantity for an item in Shipment Planning.',
        'planning',
        '[]'::jsonb,
        '[]'::jsonb,
        true,
        now(),
        now()
    ),
    (
        'e2222222-2222-2222-2222-222222222222',
        'shipment_status_ordered',
        'Shipment Planning: Status Changed to Ordered / Shipped',
        'Triggered when China Team marks an item requirement as Ordered or Shipped.',
        'planning',
        '[]'::jsonb,
        '[]'::jsonb,
        true,
        now(),
        now()
    ),
    (
        'e3333333-3333-3333-3333-333333333333',
        'sale_process_created',
        'Sale Process: Order Created',
        'Triggered when a new sale process order is confirmed and saved.',
        'sales',
        '[]'::jsonb,
        '[]'::jsonb,
        true,
        now(),
        now()
    ),
    (
        'e4444444-4444-4444-4444-444444444444',
        'local_purchase_created',
        'Local Purchase: Bill / Purchase Recorded',
        'Triggered when a local purchase bill or expense entry is recorded.',
        'purchases',
        '[]'::jsonb,
        '[]'::jsonb,
        true,
        now(),
        now()
    ),
    (
        'e5555555-5555-5555-5555-555555555555',
        'inquiry_created',
        'Inquiries: Customer Inquiry / Consignment Received',
        'Triggered when a new customer inquiry or consignment is created.',
        'inquiries',
        '[]'::jsonb,
        '[]'::jsonb,
        true,
        now(),
        now()
    )
    ON CONFLICT (event_key) DO NOTHING;
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS notification_rules")
    op.execute("ALTER TABLE notifications DROP COLUMN IF EXISTS module")
    op.execute("ALTER TABLE notifications DROP COLUMN IF EXISTS sender_id")
