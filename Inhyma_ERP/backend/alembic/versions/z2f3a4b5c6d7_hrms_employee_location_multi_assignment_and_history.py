"""hrms_employee_location_multi_assignment_and_history

Adds assigned_by and unique constraint (user_id, location_id) to hrms_employee_locations,
and creates hrms_location_assignment_history for audit tracking of location assignments.

Revision ID: z2f3a4b5c6d7
Revises: z1e2f3a4b5c6
Create Date: 2026-10-31 11:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

import app.database.base

revision: str = "z2f3a4b5c6d7"
down_revision: Union[str, None] = "z1e2f3a4b5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # 1. Update hrms_employee_locations
    if insp.has_table("hrms_employee_locations"):
        cols = {c["name"]: c for c in insp.get_columns("hrms_employee_locations")}
        if "assigned_by" not in cols:
            op.add_column(
                "hrms_employee_locations",
                sa.Column("assigned_by", app.database.base.GUID(), nullable=True),
            )
            op.create_foreign_key(
                op.f("fk_hrms_employee_locations_assigned_by_users"),
                "hrms_employee_locations",
                "users",
                ["assigned_by"],
                ["id"],
                ondelete="SET NULL",
            )

        # Deduplicate existing records if duplicate (user_id, location_id) pairs exist
        op.execute(
            """
            DELETE FROM hrms_employee_locations a USING (
                SELECT MIN(ctid) as min_ctid, user_id, location_id
                FROM hrms_employee_locations
                GROUP BY user_id, location_id HAVING COUNT(*) > 1
            ) b
            WHERE a.user_id = b.user_id
              AND a.location_id = b.location_id
              AND a.ctid <> b.min_ctid
            """
        )

        # Create unique constraint if not present
        existing_uqs = {uq["name"] for uq in insp.get_unique_constraints("hrms_employee_locations")}
        if "uq_hrms_employee_locations_user_location" not in existing_uqs:
            op.create_unique_constraint(
                "uq_hrms_employee_locations_user_location",
                "hrms_employee_locations",
                ["user_id", "location_id"],
            )

    # 2. Create hrms_location_assignment_history table
    if not insp.has_table("hrms_location_assignment_history"):
        op.create_table(
            "hrms_location_assignment_history",
            sa.Column("id", app.database.base.GUID(), nullable=False),
            sa.Column("user_id", app.database.base.GUID(), nullable=False),
            sa.Column("location_id", app.database.base.GUID(), nullable=False),
            sa.Column("action", sa.String(length=50), nullable=False),
            sa.Column("is_primary", sa.Boolean(), server_default=sa.text("false"), nullable=False),
            sa.Column("performed_by", app.database.base.GUID(), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["location_id"], ["hrms_locations.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["performed_by"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id", name=op.f("pk_hrms_location_assignment_history")),
        )
        op.create_index(
            op.f("ix_hrms_location_assignment_history_user_id"),
            "hrms_location_assignment_history",
            ["user_id"],
            unique=False,
        )
        op.create_index(
            op.f("ix_hrms_location_assignment_history_location_id"),
            "hrms_location_assignment_history",
            ["location_id"],
            unique=False,
        )
        op.create_index(
            op.f("ix_hrms_location_assignment_history_action"),
            "hrms_location_assignment_history",
            ["action"],
            unique=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table("hrms_location_assignment_history"):
        op.drop_table("hrms_location_assignment_history")

    if insp.has_table("hrms_employee_locations"):
        existing_uqs = {uq["name"] for uq in insp.get_unique_constraints("hrms_employee_locations")}
        if "uq_hrms_employee_locations_user_location" in existing_uqs:
            op.drop_constraint("uq_hrms_employee_locations_user_location", "hrms_employee_locations", type_="unique")
        cols = {c["name"]: c for c in insp.get_columns("hrms_employee_locations")}
        if "assigned_by" in cols:
            op.drop_constraint(
                op.f("fk_hrms_employee_locations_assigned_by_users"),
                "hrms_employee_locations",
                type_="foreignkey",
            )
            op.drop_column("hrms_employee_locations", "assigned_by")

