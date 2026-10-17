"""technical tasks: scale indexes, status_rank, payment/remarks columns

Revision ID: k7a8b9c0d1e2
Revises: i6f7a8b9c0d1
Create Date: 2026-10-15 12:00:00.000000

Why:
* The list screen filters by status / technician / city / date and sorts "Pending first, then Approved ...".
  Those predicates were case-insensitive ILIKE / lower() expressions that no B-tree index can serve, so every
  list, tab-count and search was a full table scan.  This migration adds:
    - ``status_rank``: a DB-maintained (GENERATED) smallint so "Pending, Approved, Payment Pending, Completed,
      Cancel" ordering is index-backed instead of a CASE sort over the whole table.
    - composite partial indexes for the real query shapes (status/rank + created, technician + status, date).
    - pg_trgm GIN indexes on every column the search box ORs together (leading-wildcard ILIKE).
    - expression indexes for the serial-number lookups (lower()/upper() comparisons).
* New columns: ``collected_amount`` (amount actually collected on completion), ``technician_remarks`` (the third
  remark, previously overwritten into ``approver_remarks``), ``company_id`` (link to the company master) and
  ``created_by_user_id`` (reliable per-user isolation).

Everything is IF NOT EXISTS, PostgreSQL only (the SQLite test database is built from the models).
The downgrade only drops indexes and the generated column; the data columns may hold real data and are kept.
"""
from alembic import op

revision = "k7a8b9c0d1e2"
down_revision = "i6f7a8b9c0d1"
branch_labels = None
depends_on = None

_TRGM_COLUMNS = (
    "company_name", "city", "machine_model", "serial_number", "contact_person_name",
    "contact_phone", "task_description", "task_allotted_to", "task_approved_by", "created_by_name",
)

_RANK_EXPR = (
    "CASE lower(status) WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 "
    "WHEN 'payment pending' THEN 2 WHEN 'payment_pending' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END"
)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm;")
    op.execute("ALTER TABLE technical_tasks ADD COLUMN IF NOT EXISTS collected_amount NUMERIC(12, 2)")
    op.execute("ALTER TABLE technical_tasks ADD COLUMN IF NOT EXISTS technician_remarks TEXT")
    op.execute("ALTER TABLE technical_tasks ADD COLUMN IF NOT EXISTS company_id UUID")
    op.execute("ALTER TABLE technical_tasks ADD COLUMN IF NOT EXISTS created_by_user_id UUID")
    op.execute(
        "ALTER TABLE technical_tasks ADD COLUMN IF NOT EXISTS status_rank SMALLINT "
        f"GENERATED ALWAYS AS ({_RANK_EXPR}) STORED"
    )

    live = "WHERE deleted_at IS NULL"
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_tt_rank_created ON technical_tasks (status_rank, created_at DESC, id) {live}")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_tt_status_created ON technical_tasks (status, created_at DESC) {live}")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_tt_tech_status ON technical_tasks (task_allotted_to, status) {live}")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_tt_created_date ON technical_tasks (task_created_date) {live}")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_tt_company_id ON technical_tasks (company_id) {live}")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_tt_creator ON technical_tasks (created_by_user_id, created_at DESC) {live}")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_tt_completed_date ON technical_tasks (completed_date) {live}")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tt_logs_call_date ON technical_task_call_logs (call_date DESC, created_at DESC)")
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_tt_service_type ON technical_tasks (service_type) {live}")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tt_city_prefix ON technical_tasks (lower(city) text_pattern_ops)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tt_tp_city_prefix ON technical_tasks (lower(third_party_city) text_pattern_ops)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tt_serial_lower ON technical_tasks (lower(serial_number))")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tt_logs_task_created ON technical_task_call_logs (task_id, created_at DESC)")
    for col in _TRGM_COLUMNS:
        op.execute(f'CREATE INDEX IF NOT EXISTS "ix_technical_tasks_{col}_trgm" ON technical_tasks USING gin ("{col}" gin_trgm_ops)')

    # Serial lookup against the warranty register compares upper(serial_number); index the same expression.
    op.execute(
        "DO $$ BEGIN IF to_regclass('machine_warranties') IS NOT NULL THEN "
        "CREATE INDEX IF NOT EXISTS ix_machine_warranties_serial_upper ON machine_warranties (upper(serial_number)); "
        "END IF; END $$;"
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    for name in (
        "ix_tt_rank_created", "ix_tt_status_created", "ix_tt_tech_status", "ix_tt_created_date", "ix_tt_company_id",
        "ix_tt_creator", "ix_tt_service_type", "ix_tt_city_prefix", "ix_tt_tp_city_prefix", "ix_tt_serial_lower",
        "ix_tt_logs_task_created", "ix_tt_completed_date", "ix_tt_logs_call_date", "ix_machine_warranties_serial_upper",
    ):
        op.execute(f"DROP INDEX IF EXISTS {name}")
    for col in _TRGM_COLUMNS:
        op.execute(f'DROP INDEX IF EXISTS "ix_technical_tasks_{col}_trgm"')
    op.execute("ALTER TABLE technical_tasks DROP COLUMN IF EXISTS status_rank")
