"""add_technical_task_logs_and_number

Adds sequential ``task_number`` to ``technical_tasks`` (for ``Technical Task #<number>``
detail routing & display) and creates ``technical_task_logs`` to persist chronological
lifecycle activity entries for the Task Log Summary view, backfilling baseline creation
entries for existing technical tasks.

Revision ID: z6d7e8f9a0b1
Revises: z5c6d7e8f9a0
Create Date: 2026-11-02 17:08:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "z6d7e8f9a0b1"
down_revision: Union[str, None] = "z5c6d7e8f9a0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing_tables = set(insp.get_table_names())
    if "technical_tasks" not in existing_tables:
        return

    if bind.dialect.name == "postgresql":
        op.execute(sa.text("CREATE SEQUENCE IF NOT EXISTS technical_tasks_task_number_seq START WITH 1 INCREMENT BY 1;"))
        op.execute(
            sa.text(
                "ALTER TABLE technical_tasks "
                "ADD COLUMN IF NOT EXISTS task_number INTEGER;"
            )
        )
        op.execute(
            sa.text(
                "ALTER TABLE technical_tasks "
                "ALTER COLUMN task_number SET DEFAULT nextval('technical_tasks_task_number_seq');"
            )
        )
        op.execute(
            sa.text(
                """
                WITH base AS (
                    SELECT COALESCE(MAX(task_number), 0) AS max_num FROM technical_tasks
                ),
                numbered AS (
                    SELECT t.id, base.max_num + ROW_NUMBER() OVER (ORDER BY t.created_at ASC, t.id ASC) AS seq_num
                    FROM technical_tasks t
                    CROSS JOIN base
                    WHERE t.task_number IS NULL
                )
                UPDATE technical_tasks tt
                SET task_number = numbered.seq_num
                FROM numbered
                WHERE tt.id = numbered.id;
                """
            )
        )
        op.execute(
            sa.text(
                """
                SELECT setval(
                    'technical_tasks_task_number_seq',
                    GREATEST(COALESCE((SELECT MAX(task_number) FROM technical_tasks), 1), 1),
                    EXISTS (SELECT 1 FROM technical_tasks WHERE task_number IS NOT NULL)
                );
                """
            )
        )
        op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_technical_tasks_task_number ON technical_tasks (task_number);"))

        op.execute(
            sa.text(
                """
                CREATE TABLE IF NOT EXISTS technical_task_logs (
                    id UUID PRIMARY KEY,
                    task_id UUID NOT NULL REFERENCES technical_tasks(id) ON DELETE CASCADE,
                    updated_by VARCHAR(150) NOT NULL DEFAULT 'Admin',
                    title VARCHAR(255) NOT NULL,
                    status VARCHAR(50) NOT NULL DEFAULT 'Pending',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                );
                """
            )
        )
        op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_technical_task_logs_task_id ON technical_task_logs (task_id);"))
        op.execute(
            sa.text(
                """
                INSERT INTO technical_task_logs (id, task_id, updated_by, title, status, created_at)
                SELECT
                    gen_random_uuid(),
                    t.id,
                    COALESCE(NULLIF(BTRIM(t.created_by_name), ''), 'Admin'),
                    'Create Technical Task',
                    'Pending',
                    COALESCE(t.created_at, now())
                FROM technical_tasks t
                WHERE NOT EXISTS (
                    SELECT 1 FROM technical_task_logs l WHERE l.task_id = t.id
                );
                """
            )
        )
    else:
        existing_cols = {c["name"] for c in insp.get_columns("technical_tasks")}
        if "task_number" not in existing_cols:
            op.add_column("technical_tasks", sa.Column("task_number", sa.Integer(), nullable=True))
            op.create_index("ix_technical_tasks_task_number", "technical_tasks", ["task_number"])
        if "technical_task_logs" not in existing_tables:
            op.create_table(
                "technical_task_logs",
                sa.Column("id", sa.String(length=36), primary_key=True),
                sa.Column("task_id", sa.String(length=36), sa.ForeignKey("technical_tasks.id", ondelete="CASCADE"), nullable=False),
                sa.Column("updated_by", sa.String(length=150), nullable=False, server_default="Admin"),
                sa.Column("title", sa.String(length=255), nullable=False),
                sa.Column("status", sa.String(length=50), nullable=False, server_default="Pending"),
                sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            )
            op.create_index("ix_technical_task_logs_task_id", "technical_task_logs", ["task_id"])


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing_tables = set(insp.get_table_names())
    if "technical_task_logs" in existing_tables:
        op.drop_table("technical_task_logs")
    if "technical_tasks" in existing_tables:
        existing_cols = {c["name"] for c in insp.get_columns("technical_tasks")}
        if "task_number" in existing_cols:
            if bind.dialect.name == "postgresql":
                op.execute(sa.text("DROP INDEX IF EXISTS ix_technical_tasks_task_number;"))
                op.execute(sa.text("ALTER TABLE technical_tasks DROP COLUMN IF EXISTS task_number;"))
                op.execute(sa.text("DROP SEQUENCE IF EXISTS technical_tasks_task_number_seq;"))
            else:
                op.drop_index("ix_technical_tasks_task_number", table_name="technical_tasks")
                op.drop_column("technical_tasks", "task_number")

