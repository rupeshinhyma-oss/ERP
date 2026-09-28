"""create_hrms_attendance_regularizations_table

Creates hrms_attendance_regularizations table.

Revision ID: g1a2b3c4d5e9
Revises: f1a2b3c4d5e8
Create Date: 2026-09-26 16:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import app.database.base

# revision identifiers, used by Alembic.
revision: str = "g1a2b3c4d5e9"
down_revision: Union[str, None] = "f1a2b3c4d5e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table("hrms_attendance_regularizations"):
        op.create_table(
            "hrms_attendance_regularizations",
            sa.Column("id", app.database.base.GUID(), nullable=False),
            sa.Column("employee_id", app.database.base.GUID(), nullable=False),
            sa.Column("attendance_record_id", app.database.base.GUID(), nullable=True),
            sa.Column("attendance_date", sa.Date(), nullable=False),
            sa.Column("request_type", sa.String(length=50), server_default="LATE_PUNCH", nullable=False),
            sa.Column("reason", sa.String(length=255), nullable=False),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=50), server_default="PENDING", nullable=False),
            sa.Column("submitted_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("reviewed_by", app.database.base.GUID(), nullable=True),
            sa.Column("manager_remarks", sa.Text(), nullable=True),
            sa.Column("action_taken", sa.String(length=50), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
            sa.ForeignKeyConstraint(
                ["employee_id"],
                ["users.id"],
                name=op.f("fk_hrms_attendance_regularizations_employee_id_users"),
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["attendance_record_id"],
                ["hrms_attendance.id"],
                name=op.f("fk_hrms_attendance_regularizations_attendance_record_id_hrms_attendance"),
                ondelete="SET NULL",
            ),
            sa.ForeignKeyConstraint(
                ["reviewed_by"],
                ["users.id"],
                name=op.f("fk_hrms_attendance_regularizations_reviewed_by_users"),
                ondelete="SET NULL",
            ),
            sa.PrimaryKeyConstraint("id", name=op.f("pk_hrms_attendance_regularizations")),
        )
        op.create_index(
            op.f("ix_hrms_attendance_regularizations_employee_id"),
            "hrms_attendance_regularizations",
            ["employee_id"],
            unique=False,
        )
        op.create_index(
            op.f("ix_hrms_attendance_regularizations_attendance_date"),
            "hrms_attendance_regularizations",
            ["attendance_date"],
            unique=False,
        )
        op.create_index(
            op.f("ix_hrms_attendance_regularizations_status"),
            "hrms_attendance_regularizations",
            ["status"],
            unique=False,
        )
        op.create_index(
            op.f("ix_hrms_attendance_regularizations_attendance_record_id"),
            "hrms_attendance_regularizations",
            ["attendance_record_id"],
            unique=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table("hrms_attendance_regularizations"):
        op.drop_index(
            op.f("ix_hrms_attendance_regularizations_attendance_record_id"),
            table_name="hrms_attendance_regularizations",
        )
        op.drop_index(
            op.f("ix_hrms_attendance_regularizations_status"),
            table_name="hrms_attendance_regularizations",
        )
        op.drop_index(
            op.f("ix_hrms_attendance_regularizations_attendance_date"),
            table_name="hrms_attendance_regularizations",
        )
        op.drop_index(
            op.f("ix_hrms_attendance_regularizations_employee_id"),
            table_name="hrms_attendance_regularizations",
        )
        op.drop_table("hrms_attendance_regularizations")
