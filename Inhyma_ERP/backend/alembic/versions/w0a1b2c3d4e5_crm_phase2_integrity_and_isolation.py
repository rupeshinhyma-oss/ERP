"""crm_phase2_integrity_and_isolation

Revision ID: w0a1b2c3d4e5
Revises: v9a0b1c2d3e4
Create Date: 2026-11-17 14:50:00.000000

Implements CRM Phase 2 data-integrity and isolation schema enhancements:
1. CRM-AUD-04: Enforces UniqueConstraint(quotation_id, version) on ``crm_quotation_versions``
   (safely re-sequencing any pre-existing duplicate archived version numbers without deleting rows)
   and ensures uniqueness on ``crm_sales_quotations.quotation_number``.
2. CRM-AUD-07: Creates partial unique index ``uq_crm_leads_active_normalized_phone`` on
   ``crm_leads (normalized_phone) WHERE deleted_at IS NULL AND normalized_phone IS NOT NULL``
   after deterministic conflict checks.
3. CRM-AUD-02: Adds nullable ``owner_user_id`` and ``created_by_user_id`` UUID foreign keys
   (``-> users.id ON DELETE SET NULL``) and indexes to legacy ``leads`` and ``follow_ups``
   tables, backfilling only deterministic exact-username matches.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.database.base import GUID

revision: str = "w0a1b2c3d4e5"
down_revision: Union[str, Sequence[str], None] = "v9a0b1c2d3e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    dialect = bind.dialect.name

    # ------------------------------------------------------------------
    # 1. CRM-AUD-04: crm_quotation_versions uniqueness (quotation_id, version)
    # ------------------------------------------------------------------
    if insp.has_table("crm_quotation_versions"):
        if dialect == "postgresql":
            # Safely re-sequence any duplicate (quotation_id, version) rows without data deletion
            bind.execute(
                sa.text(
                    """
                    WITH ranked AS (
                        SELECT
                            id,
                            quotation_id,
                            version,
                            ROW_NUMBER() OVER (
                                PARTITION BY quotation_id, version
                                ORDER BY created_at ASC, id ASC
                            ) AS rn,
                            MAX(version) OVER (PARTITION BY quotation_id) AS max_v
                        FROM crm_quotation_versions
                    ),
                    dups AS (
                        SELECT
                            id,
                            quotation_id,
                            max_v + ROW_NUMBER() OVER (
                                PARTITION BY quotation_id
                                ORDER BY version ASC, id ASC
                            ) AS new_version
                        FROM ranked
                        WHERE rn > 1
                    )
                    UPDATE crm_quotation_versions qv
                    SET version = dups.new_version
                    FROM dups
                    WHERE qv.id = dups.id
                    """
                )
            )

        insp = sa.inspect(bind)
        qv_uqs = {
            uq["name"] for uq in insp.get_unique_constraints("crm_quotation_versions") if uq.get("name")
        }
        if "uq_crm_quotation_versions_quotation_version" not in qv_uqs:
            op.create_unique_constraint(
                "uq_crm_quotation_versions_quotation_version",
                "crm_quotation_versions",
                ["quotation_id", "version"],
            )

    # Ensure quotation_number uniqueness on crm_sales_quotations
    if insp.has_table("crm_sales_quotations"):
        sq_uqs = {
            uq["name"] for uq in insp.get_unique_constraints("crm_sales_quotations") if uq.get("name")
        }
        sq_idxs = {
            idx["name"]: idx for idx in insp.get_indexes("crm_sales_quotations") if idx.get("name")
        }
        has_qnum_unique = any(
            uq.get("column_names") == ["quotation_number"]
            for uq in insp.get_unique_constraints("crm_sales_quotations")
        ) or any(
            idx.get("column_names") == ["quotation_number"] and idx.get("unique")
            for idx in sq_idxs.values()
        )
        if not has_qnum_unique and "uq_crm_sales_quotations_quotation_number" not in sq_uqs:
            op.create_unique_constraint(
                "uq_crm_sales_quotations_quotation_number",
                "crm_sales_quotations",
                ["quotation_number"],
            )

    # ------------------------------------------------------------------
    # 2. CRM-AUD-07: Partial unique index on active crm_leads.normalized_phone
    # ------------------------------------------------------------------
    if insp.has_table("crm_leads"):
        if dialect == "postgresql":
            # Deterministically soft-archive any pre-existing duplicate active normalized_phone rows
            # (preserving the earliest created active lead and keeping the duplicate row in soft-deleted state)
            bind.execute(
                sa.text(
                    """
                    WITH ranked_leads AS (
                        SELECT
                            id,
                            normalized_phone,
                            ROW_NUMBER() OVER (
                                PARTITION BY normalized_phone
                                ORDER BY created_at ASC, id ASC
                            ) AS rn
                        FROM crm_leads
                        WHERE deleted_at IS NULL
                          AND normalized_phone IS NOT NULL
                    )
                    UPDATE crm_leads
                    SET deleted_at = NOW()
                    WHERE id IN (
                        SELECT id FROM ranked_leads WHERE rn > 1
                    )
                    """
                )
            )

        insp = sa.inspect(bind)
        lead_idxs = {idx["name"] for idx in insp.get_indexes("crm_leads") if idx.get("name")}
        if "uq_crm_leads_active_normalized_phone" not in lead_idxs:
            op.create_index(
                "uq_crm_leads_active_normalized_phone",
                "crm_leads",
                ["normalized_phone"],
                unique=True,
                postgresql_where=sa.text("deleted_at IS NULL AND normalized_phone IS NOT NULL"),
                sqlite_where=sa.text("deleted_at IS NULL AND normalized_phone IS NOT NULL"),
            )

    # ------------------------------------------------------------------
    # 3. CRM-AUD-02: Legacy leads & follow_ups canonical UUID ownership columns
    # ------------------------------------------------------------------
    if insp.has_table("leads"):
        lead_cols = {c["name"] for c in insp.get_columns("leads")}
        if "owner_user_id" not in lead_cols:
            op.add_column("leads", sa.Column("owner_user_id", GUID(), nullable=True))
        if "created_by_user_id" not in lead_cols:
            op.add_column("leads", sa.Column("created_by_user_id", GUID(), nullable=True))

        insp = sa.inspect(bind)
        lead_fks = {fk["name"] for fk in insp.get_foreign_keys("leads") if fk.get("name")}
        if "fk_leads_owner_user_id_users" not in lead_fks:
            op.create_foreign_key(
                "fk_leads_owner_user_id_users",
                "leads",
                "users",
                ["owner_user_id"],
                ["id"],
                ondelete="SET NULL",
            )
        if "fk_leads_created_by_user_id_users" not in lead_fks:
            op.create_foreign_key(
                "fk_leads_created_by_user_id_users",
                "leads",
                "users",
                ["created_by_user_id"],
                ["id"],
                ondelete="SET NULL",
            )

        lead_indexes = {idx["name"] for idx in insp.get_indexes("leads") if idx.get("name")}
        if "ix_leads_owner_user_id" not in lead_indexes:
            op.create_index("ix_leads_owner_user_id", "leads", ["owner_user_id"], unique=False)
        if "ix_leads_created_by_user_id" not in lead_indexes:
            op.create_index("ix_leads_created_by_user_id", "leads", ["created_by_user_id"], unique=False)

        # Deterministic backfill ONLY when allotted_to / created_by matches an exact unique username
        if insp.has_table("users"):
            bind.execute(
                sa.text(
                    """
                    UPDATE leads
                    SET owner_user_id = u.id
                    FROM users u
                    WHERE leads.owner_user_id IS NULL
                      AND leads.allotted_to IS NOT NULL
                      AND u.deleted_at IS NULL
                      AND LOWER(TRIM(leads.allotted_to)) = LOWER(u.username)
                    """
                )
            )
            bind.execute(
                sa.text(
                    """
                    UPDATE leads
                    SET created_by_user_id = u.id
                    FROM users u
                    WHERE leads.created_by_user_id IS NULL
                      AND leads.created_by IS NOT NULL
                      AND u.deleted_at IS NULL
                      AND LOWER(TRIM(leads.created_by)) = LOWER(u.username)
                    """
                )
            )

    if insp.has_table("follow_ups"):
        fu_cols = {c["name"] for c in insp.get_columns("follow_ups")}
        if "owner_user_id" not in fu_cols:
            op.add_column("follow_ups", sa.Column("owner_user_id", GUID(), nullable=True))
        if "created_by_user_id" not in fu_cols:
            op.add_column("follow_ups", sa.Column("created_by_user_id", GUID(), nullable=True))

        insp = sa.inspect(bind)
        fu_fks = {fk["name"] for fk in insp.get_foreign_keys("follow_ups") if fk.get("name")}
        if "fk_follow_ups_owner_user_id_users" not in fu_fks:
            op.create_foreign_key(
                "fk_follow_ups_owner_user_id_users",
                "follow_ups",
                "users",
                ["owner_user_id"],
                ["id"],
                ondelete="SET NULL",
            )
        if "fk_follow_ups_created_by_user_id_users" not in fu_fks:
            op.create_foreign_key(
                "fk_follow_ups_created_by_user_id_users",
                "follow_ups",
                "users",
                ["created_by_user_id"],
                ["id"],
                ondelete="SET NULL",
            )

        fu_indexes = {idx["name"] for idx in insp.get_indexes("follow_ups") if idx.get("name")}
        if "ix_follow_ups_owner_user_id" not in fu_indexes:
            op.create_index("ix_follow_ups_owner_user_id", "follow_ups", ["owner_user_id"], unique=False)
        if "ix_follow_ups_created_by_user_id" not in fu_indexes:
            op.create_index("ix_follow_ups_created_by_user_id", "follow_ups", ["created_by_user_id"], unique=False)

        if insp.has_table("users"):
            bind.execute(
                sa.text(
                    """
                    UPDATE follow_ups
                    SET owner_user_id = u.id
                    FROM users u
                    WHERE follow_ups.owner_user_id IS NULL
                      AND follow_ups.marketing_person IS NOT NULL
                      AND u.deleted_at IS NULL
                      AND LOWER(TRIM(follow_ups.marketing_person)) = LOWER(u.username)
                    """
                )
            )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table("follow_ups"):
        fu_indexes = {idx["name"] for idx in insp.get_indexes("follow_ups") if idx.get("name")}
        if "ix_follow_ups_created_by_user_id" in fu_indexes:
            op.drop_index("ix_follow_ups_created_by_user_id", table_name="follow_ups")
        if "ix_follow_ups_owner_user_id" in fu_indexes:
            op.drop_index("ix_follow_ups_owner_user_id", table_name="follow_ups")

        fu_fks = {fk["name"] for fk in insp.get_foreign_keys("follow_ups") if fk.get("name")}
        if "fk_follow_ups_created_by_user_id_users" in fu_fks:
            op.drop_constraint("fk_follow_ups_created_by_user_id_users", "follow_ups", type_="foreignkey")
        if "fk_follow_ups_owner_user_id_users" in fu_fks:
            op.drop_constraint("fk_follow_ups_owner_user_id_users", "follow_ups", type_="foreignkey")

        fu_cols = {c["name"] for c in insp.get_columns("follow_ups")}
        if "created_by_user_id" in fu_cols:
            op.drop_column("follow_ups", "created_by_user_id")
        if "owner_user_id" in fu_cols:
            op.drop_column("follow_ups", "owner_user_id")

    if insp.has_table("leads"):
        lead_indexes = {idx["name"] for idx in insp.get_indexes("leads") if idx.get("name")}
        if "ix_leads_created_by_user_id" in lead_indexes:
            op.drop_index("ix_leads_created_by_user_id", table_name="leads")
        if "ix_leads_owner_user_id" in lead_indexes:
            op.drop_index("ix_leads_owner_user_id", table_name="leads")

        lead_fks = {fk["name"] for fk in insp.get_foreign_keys("leads") if fk.get("name")}
        if "fk_leads_created_by_user_id_users" in lead_fks:
            op.drop_constraint("fk_leads_created_by_user_id_users", "leads", type_="foreignkey")
        if "fk_leads_owner_user_id_users" in lead_fks:
            op.drop_constraint("fk_leads_owner_user_id_users", "leads", type_="foreignkey")

        lead_cols = {c["name"] for c in insp.get_columns("leads")}
        if "created_by_user_id" in lead_cols:
            op.drop_column("leads", "created_by_user_id")
        if "owner_user_id" in lead_cols:
            op.drop_column("leads", "owner_user_id")

    if insp.has_table("crm_leads"):
        lead_idxs = {idx["name"] for idx in insp.get_indexes("crm_leads") if idx.get("name")}
        if "uq_crm_leads_active_normalized_phone" in lead_idxs:
            op.drop_index("uq_crm_leads_active_normalized_phone", table_name="crm_leads")

    if insp.has_table("crm_sales_quotations"):
        sq_uqs = {
            uq["name"] for uq in insp.get_unique_constraints("crm_sales_quotations") if uq.get("name")
        }
        if "uq_crm_sales_quotations_quotation_number" in sq_uqs:
            op.drop_constraint(
                "uq_crm_sales_quotations_quotation_number",
                "crm_sales_quotations",
                type_="unique",
            )

    if insp.has_table("crm_quotation_versions"):
        qv_uqs = {
            uq["name"] for uq in insp.get_unique_constraints("crm_quotation_versions") if uq.get("name")
        }
        if "uq_crm_quotation_versions_quotation_version" in qv_uqs:
            op.drop_constraint(
                "uq_crm_quotation_versions_quotation_version",
                "crm_quotation_versions",
                type_="unique",
            )
