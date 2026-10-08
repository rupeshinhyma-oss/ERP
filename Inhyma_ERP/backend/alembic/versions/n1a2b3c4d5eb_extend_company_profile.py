"""extend_company_profile

Persist the fields the Add Company spec requires that were missing from the Company and
CompanyContact tables: Monthly Turnover, Potential Business per month, the Direct Import
from China cluster (Yes/No, Monthly Import Volume, Products needed for imports), and
contact Birth Date / Anniversary Date.

Revision ID: n1a2b3c4d5eb
Revises: m1a2b3c4d5ea
Create Date: 2026-10-07 09:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "n1a2b3c4d5eb"
down_revision: Union[str, None] = "m1a2b3c4d5ea"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COMPANY_COLUMNS = [
    ("monthly_turnover", sa.String(50), {}),
    ("potential_business_per_month", sa.String(50), {}),
    ("direct_import_from_china", sa.String(10), {}),
    ("monthly_import_volume", sa.String(50), {}),
    ("products_needed_for_imports", sa.Text(), {}),
]

CONTACT_COLUMNS = [
    ("birth_date", sa.String(20), {}),
    ("anniversary_date", sa.String(20), {}),
]


def _add_missing(table: str, columns) -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}
    for name, col_type, kwargs in columns:
        if name not in existing:
            op.add_column(table, sa.Column(name, col_type, **({"nullable": True} | kwargs)))


def upgrade() -> None:
    _add_missing("companies", COMPANY_COLUMNS)
    _add_missing("company_contacts", CONTACT_COLUMNS)


def downgrade() -> None:
    for name, *_ in reversed(CONTACT_COLUMNS):
        op.drop_column("company_contacts", name)
    for name, *_ in reversed(COMPANY_COLUMNS):
        op.drop_column("companies", name)
