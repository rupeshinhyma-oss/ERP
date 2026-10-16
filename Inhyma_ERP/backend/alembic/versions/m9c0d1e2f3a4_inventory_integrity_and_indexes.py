"""inventory: one stock row per product, correct Total Qty, real adjustment dates, scale indexes

Revision ID: m9c0d1e2f3a4
Revises: l8b9c0d1e2f3
Create Date: 2026-10-17 10:00:00.000000

Data repairs (PostgreSQL only; all idempotent):
* product_stocks.product_id is filled in from the Product Master (exact name) for old rows that lack it;
* products that ended up with more than one live stock row (a race on first use) are merged into the oldest row --
  every warehouse balance is added up, the extra rows are soft-deleted -- and only then does a UNIQUE index guard it;
* total_qty is recomputed for every row from the nine warehouse balances (it used to include the reorder level and
  the minimum order quantity);
* stock_adjustments.adjustment_dt (a real DATE) is back-filled from the DD-MM-YYYY text so the date range filter and
  the ordering work on dates, not on strings.
Indexes: brand, default ordering, lower(name) lookups used by every stock movement, trigram indexes for the list search.
The downgrade drops the indexes only; repaired data is kept.
"""
from alembic import op

revision = "m9c0d1e2f3a4"
down_revision = "l8b9c0d1e2f3"
branch_labels = None
depends_on = None

_BAL = ("mumbai", "mumbai_transit", "mumbai_ordered", "ahmedabad", "ahmedabad_transit", "ahmedabad_ordered",
        "indore", "indore_transit", "indore_ordered")
_TRGM = ("product_name_tally", "product_code", "brand", "sub_category")


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm;")

    # ---- adjustment dates --------------------------------------------------------------------------------------
    op.execute("ALTER TABLE stock_adjustments ADD COLUMN IF NOT EXISTS adjustment_dt DATE")
    op.execute(
        """
        CREATE OR REPLACE FUNCTION pg_temp.safe_to_date(txt text, fmt text) RETURNS date AS $$
        BEGIN RETURN to_date(txt, fmt); EXCEPTION WHEN others THEN RETURN NULL; END $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        """
        UPDATE stock_adjustments
           SET adjustment_dt = CASE WHEN adjustment_date ~ '^[0-9]{2}-[0-9]{2}-[0-9]{4}'
                                    THEN pg_temp.safe_to_date(substr(adjustment_date, 1, 10), 'DD-MM-YYYY')
                                    WHEN adjustment_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                                    THEN pg_temp.safe_to_date(substr(adjustment_date, 1, 10), 'YYYY-MM-DD') END
         WHERE adjustment_dt IS NULL
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_stock_adjustments_adjustment_dt ON stock_adjustments (adjustment_dt)")

    # ---- one stock row per product ------------------------------------------------------------------------------
    op.execute(
        """
        UPDATE product_stocks ps SET product_id = p.id
          FROM products p
         WHERE ps.product_id IS NULL AND ps.deleted_at IS NULL AND p.deleted_at IS NULL
           AND lower(ps.product_name_tally) = lower(p.product_name_tally)
        """
    )
    sums = ", ".join(f"sum(s.{c}) AS {c}" for c in _BAL)
    sets = ", ".join(f"{c} = k.{c} + x.{c}" for c in _BAL)
    ranked = (
        "SELECT id, product_id, row_number() OVER (PARTITION BY product_id ORDER BY created_at, id) AS rn "
        "FROM product_stocks WHERE deleted_at IS NULL AND product_id IS NOT NULL"
    )
    op.execute(
        f"""
        WITH ranked AS ({ranked}),
        extra AS (SELECT r.product_id, {sums} FROM product_stocks s JOIN ranked r ON r.id = s.id WHERE r.rn > 1 GROUP BY r.product_id)
        UPDATE product_stocks k SET {sets}
          FROM extra x JOIN ranked keep ON keep.product_id = x.product_id AND keep.rn = 1
         WHERE k.id = keep.id
        """
    )
    op.execute(
        f"""
        WITH ranked AS ({ranked})
        UPDATE product_stocks SET deleted_at = now() WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
        """
    )
    total = " + ".join(f"coalesce({c}, 0)" for c in _BAL)
    op.execute(f"UPDATE product_stocks SET total_qty = round(({total})::numeric, 6) WHERE total_qty IS DISTINCT FROM round(({total})::numeric, 6)")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_product_stocks_product_id ON product_stocks (product_id) "
        "WHERE deleted_at IS NULL AND product_id IS NOT NULL"
    )

    # ---- speed ---------------------------------------------------------------------------------------------------
    op.execute("CREATE INDEX IF NOT EXISTS ix_product_stocks_brand ON product_stocks (brand)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_product_stocks_list_order ON product_stocks (sr_no, created_at DESC) WHERE deleted_at IS NULL")
    op.execute("CREATE INDEX IF NOT EXISTS ix_product_stocks_lower_name ON product_stocks (lower(product_name_tally))")
    op.execute("CREATE INDEX IF NOT EXISTS ix_products_lower_tally ON products (lower(product_name_tally))")
    op.execute("CREATE INDEX IF NOT EXISTS ix_products_lower_name ON products (lower(product_name))")
    for col in _TRGM:
        op.execute(f'CREATE INDEX IF NOT EXISTS "ix_product_stocks_{col}_trgm" ON product_stocks USING gin ("{col}" gin_trgm_ops)')


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    for name in ("uq_product_stocks_product_id", "ix_product_stocks_brand", "ix_product_stocks_list_order",
                 "ix_product_stocks_lower_name", "ix_products_lower_tally", "ix_products_lower_name",
                 "ix_stock_adjustments_adjustment_dt"):
        op.execute(f"DROP INDEX IF EXISTS {name}")
    for col in _TRGM:
        op.execute(f'DROP INDEX IF EXISTS "ix_product_stocks_{col}_trgm"')
