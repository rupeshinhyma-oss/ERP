"""purge_synthetic_pytest_artifacts

Surgically removes synthetic pytest fixture users (``rec_mgr_*``, ``rec_user_*``,
``outsider_rep_*``, ``*@inhyma.test``), their recurring schedules/tasks, and
synthetic random-digit pytest companies that were inserted before pytest SQLite
isolation was enforced. Strictly preserves all real users and operational records.

Revision ID: z5c6d7e8f9a0
Revises: z4b5c6d7e8f9
Create Date: 2026-10-31 17:32:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "z5c6d7e8f9a0"
down_revision: Union[str, None] = "z4b5c6d7e8f9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


SYNTHETIC_USER_WHERE = """
(
    username LIKE 'rec_mgr_%'
    OR username LIKE 'rec_user_%'
    OR username LIKE 'outsider_rep_%'
    OR email LIKE '%@inhyma.test'
    OR email LIKE 'rec_%@example.com'
    OR email LIKE 'outsider_rep_%@example.com'
)
AND username <> 'admin'
"""


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    insp = sa.inspect(bind)
    existing_tables = set(insp.get_table_names())
    if "users" not in existing_tables:
        return

    # 1. Remove tasks & recurring schedules created by synthetic pytest users
    if "task_recurring_schedules" in existing_tables and "tasks" in existing_tables:
        op.execute(
            sa.text(
                f"""
                DELETE FROM tasks
                WHERE created_by IN (SELECT id FROM users WHERE {SYNTHETIC_USER_WHERE})
                   OR recurring_schedule_id IN (
                       SELECT id FROM task_recurring_schedules
                       WHERE created_by IN (SELECT id FROM users WHERE {SYNTHETIC_USER_WHERE})
                   )
                """
            )
        )
        op.execute(
            sa.text(
                f"""
                DELETE FROM task_recurring_schedules
                WHERE created_by IN (SELECT id FROM users WHERE {SYNTHETIC_USER_WHERE})
                """
            )
        )
    elif "tasks" in existing_tables:
        op.execute(
            sa.text(
                f"""
                DELETE FROM tasks
                WHERE created_by IN (SELECT id FROM users WHERE {SYNTHETIC_USER_WHERE})
                """
            )
        )

    # 2. Remove unreferenced synthetic pytest companies from test_crm_company_integration.py
    if "companies" in existing_tables:
        op.execute(
            sa.text(
                """
                DELETE FROM companies c
                WHERE c.company_name ~ '^(Nova Robotics Tech|Paramount Automations|Initial Firm|Delta Pneumatics) [0-9]{8} (Pvt )?Ltd$'
                  AND NOT EXISTS (
                      SELECT 1 FROM crm_leads l WHERE l.company_id = c.id
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM crm_sales_quotations q WHERE q.company_id = c.id
                  )
                """
            )
        )

    # 3. Remove synthetic pytest users (FKs on sessions, notifications, user_roles, etc. CASCADE/SET NULL)
    op.execute(
        sa.text(
            f"""
            DELETE FROM users
            WHERE {SYNTHETIC_USER_WHERE}
              AND NOT EXISTS (SELECT 1 FROM inquiries i WHERE i.created_by = users.id)
              AND NOT EXISTS (SELECT 1 FROM sales_orders so WHERE so.created_by_id = users.id)
              AND NOT EXISTS (SELECT 1 FROM quotations qt WHERE qt.created_by = users.id)
              AND NOT EXISTS (SELECT 1 FROM rfqs rf WHERE rf.created_by = users.id)
            """
        )
    )


def downgrade() -> None:
    # Irreversible data hygiene migration (synthetic test artifacts only).
    pass

