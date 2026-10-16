"""companies: district_id (State -> District -> City) + scale indexes

Revision ID: l8b9c0d1e2f3
Revises: k7a8b9c0d1e2
Create Date: 2026-10-16 10:00:00.000000

* ``companies.district_id`` -- the district was only stored as free text, so the State -> District -> City
  cascade could not be validated, filtered exactly or kept consistent. The new nullable FK is back-filled from
  the existing text (case-insensitive name match inside the company's state) and from the company's city
  (when the city belongs to a district). The ``district`` text column stays as the display name.
* Indexes that the list / duplicate checks need at 1M+ companies (PostgreSQL only, IF NOT EXISTS):
    - ``upper(tax_id_number)``: the duplicate-GST check compares ``upper(col) = :gst`` and had no usable index;
    - a partial composite on the common filter prefix (active flag + state + district + city);
    - a partial index for the default "newest first" ordering of the active list.
The downgrade drops the indexes and the column.
"""
from alembic import op

revision = "l8b9c0d1e2f3"
down_revision = "k7a8b9c0d1e2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute(
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS district_id UUID "
        "REFERENCES districts(id) ON DELETE SET NULL"
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_companies_district_id ON companies (district_id)")

    # Back-fill 1: text district -> district master (same state, case/space-insensitive name).
    op.execute(
        """
        UPDATE companies c
           SET district_id = d.id
          FROM districts d
         WHERE c.district_id IS NULL
           AND c.district IS NOT NULL
           AND c.state_id = d.state_id
           AND d.deleted_at IS NULL
           AND lower(btrim(c.district)) = lower(btrim(d.name))
        """
    )
    # Back-fill 2: no usable text, but the city belongs to a district.
    op.execute(
        """
        UPDATE companies c
           SET district_id = ci.district_id,
               district = COALESCE(NULLIF(btrim(c.district), ''), d.name)
          FROM cities ci
          JOIN districts d ON d.id = ci.district_id
         WHERE c.district_id IS NULL
           AND c.city_id = ci.id
           AND ci.district_id IS NOT NULL
        """
    )

    live = "WHERE deleted_at IS NULL"
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_companies_tax_upper ON companies (upper(tax_id_number)) {live}")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_companies_active_geo "
        f"ON companies (is_active, state_id, district_id, city_id) {live}"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_companies_active_created "
        f"ON companies (is_active, created_at DESC) {live}"
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    for name in ("ix_companies_active_created", "ix_companies_active_geo", "ix_companies_tax_upper", "ix_companies_district_id"):
        op.execute(f"DROP INDEX IF EXISTS {name}")
    op.execute("ALTER TABLE companies DROP COLUMN IF EXISTS district_id")
