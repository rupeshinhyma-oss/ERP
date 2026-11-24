"""crm_pipeline_single_default_index

Revision ID: z7f8a9b0c1d2
Revises: z6e7f8a9b0c1
Create Date: 2026-11-21 13:15:00.000000

Lead Management Phase 2 / Wave 2 (LM-DEF-007):
Enforces the database-level single-active-default CRM pipeline invariant via
partial unique index `uq_crm_pipelines_single_default` on `crm_pipelines`
(`WHERE is_default IS TRUE AND deleted_at IS NULL`).

Safety rule:
- Verifies no duplicate active default rows exist prior to creating the index.
- Refuses to arbitrarily mutate or choose a default if duplicates exist.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "z7f8a9b0c1d2"
down_revision: Union[str, Sequence[str], None] = "z6e7f8a9b0c1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INDEX_NAME = "uq_crm_pipelines_single_default"


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    dialect = bind.dialect.name

    if not insp.has_table("crm_pipelines"):
        return

    # Fail safely if duplicate active defaults exist rather than silently mutating data
    dup_count = bind.execute(
        sa.text(
            "SELECT COUNT(*) FROM crm_pipelines "
            "WHERE is_default IS TRUE AND deleted_at IS NULL"
        )
    ).scalar_one()
    if dup_count > 1:
        raise RuntimeError(
            f"Cannot create {INDEX_NAME}: found {dup_count} active default CRM pipelines "
            "(is_default IS TRUE AND deleted_at IS NULL). Resolve duplicate defaults manually first."
        )

    if dialect == "postgresql":
        bind.execute(
            sa.text(
                f"""
                CREATE UNIQUE INDEX IF NOT EXISTS {INDEX_NAME}
                ON crm_pipelines (is_default)
                WHERE is_default IS TRUE AND deleted_at IS NULL
                """
            )
        )
    else:
        existing_idx = {i["name"] for i in insp.get_indexes("crm_pipelines") if i.get("name")}
        if INDEX_NAME not in existing_idx:
            op.create_index(
                INDEX_NAME,
                "crm_pipelines",
                ["is_default"],
                unique=True,
                sqlite_where=sa.text("is_default = 1 AND deleted_at IS NULL"),
            )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    dialect = bind.dialect.name

    if not insp.has_table("crm_pipelines"):
        return

    if dialect == "postgresql":
        bind.execute(sa.text(f"DROP INDEX IF EXISTS {INDEX_NAME}"))
    else:
        existing_idx = {i["name"] for i in insp.get_indexes("crm_pipelines") if i.get("name")}
        if INDEX_NAME in existing_idx:
            op.drop_index(INDEX_NAME, table_name="crm_pipelines")
