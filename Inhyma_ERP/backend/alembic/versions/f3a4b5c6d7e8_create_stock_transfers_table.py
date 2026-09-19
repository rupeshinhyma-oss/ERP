"""create_stock_transfers_table

Revision ID: f3a4b5c6d7e8
Revises: e2f3a4b5c6d7
Create Date: 2026-09-19 15:10:00.000000

"""
import uuid
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import app.database.base

# revision identifiers, used by Alembic.
revision: str = 'f3a4b5c6d7e8'
down_revision: Union[str, None] = 'e2f3a4b5c6d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


SEED_TRANSFERS = [
    # Top 10 from live screenshot
    {
        "sr_no": 52,
        "transfer_no": "TRF-2026-052",
        "transfer_date": "18-09-2026 04:37 PM",
        "from_warehouse": "Ahmedabad",
        "to_warehouse": "Mumbai",
        "total_amount": 629534.06,
        "added_by": "Akshata Wadekar",
        "status": "Received",
        "remarks": "Inter-branch stock transfer from Ahmedabad warehouse to Mumbai main hub",
        "items": [
            {"product_name": "FFS500 Centre sealer 300mm", "product_code": "MACH-FFS500", "category": "Machines", "quantity": 3.0, "uom": "PCS", "rate": 37494.85, "amount": 112484.55},
            {"product_name": "FFS1000 Centre Sealer 420mm", "product_code": "MACH-FFS1000", "category": "Machines", "quantity": 2.0, "uom": "PCS", "rate": 54023.78, "amount": 108047.56},
            {"product_name": "GF100FD Granular Filler Double Head FFS", "product_code": "MACH-GF100FD", "category": "Machines", "quantity": 2.0, "uom": "PCS", "rate": 17150.74, "amount": 34301.48},
            {"product_name": "GF1000F Granular Filler FFS", "product_code": "MACH-GF1000F", "category": "Machines", "quantity": 4.0, "uom": "PCS", "rate": 14315.88, "amount": 57263.52},
            {"product_name": "GF1000FD Granular Filler Double Head FFS", "product_code": "MACH-GF1000FD", "category": "Machines", "quantity": 1.0, "uom": "PCS", "rate": 30442.71, "amount": 30442.71},
            {"product_name": "GF5000 Granular Filler", "product_code": "MACH-GF5000", "category": "Machines", "quantity": 3.0, "uom": "PCS", "rate": 20423.10, "amount": 61269.30},
            {"product_name": "DZ400 2B Vacuum machine", "product_code": "MACH-DZ400", "category": "Machines", "quantity": 2.0, "uom": "PCS", "rate": 24771.60, "amount": 49543.20},
            {"product_name": "FXJ6050 Semi Automatic Carton Sealer 3\"", "product_code": "MACH-FXJ6050", "category": "Machines", "quantity": 1.0, "uom": "PCS", "rate": 49649.85, "amount": 49649.85},
            {"product_name": "FQL450 Auto L-sealer w/o Connect parts", "product_code": "MACH-FQL450", "category": "Machines", "quantity": 1.0, "uom": "PCS", "rate": 126531.89, "amount": 126531.89},
        ],
    },
    {
        "sr_no": 51,
        "transfer_no": "TRF-2026-051",
        "transfer_date": "18-09-2026 03:25 PM",
        "from_warehouse": "Indore",
        "to_warehouse": "Ahmedabad",
        "total_amount": 46166.85,
        "added_by": "Akshata Wadekar",
        "status": "Received",
        "remarks": "Urgent spare replenishment for client breakdown in Ahmedabad",
        "items": [
            {"product_name": "Temperature Controller Omron E5CC", "product_code": "ELEC-012", "category": "Spares", "quantity": 5.0, "uom": "PCS", "rate": 9233.37, "amount": 46166.85},
        ],
    },
    {
        "sr_no": 50,
        "transfer_no": "TRF-2026-050",
        "transfer_date": "18-09-2026 03:24 PM",
        "from_warehouse": "Indore",
        "to_warehouse": "Mumbai",
        "total_amount": 2748194.00,
        "added_by": "Akshata Wadekar",
        "status": "Received",
        "remarks": "Full automated line transfer for packaging exhibition consignment",
        "items": [
            {"product_name": "ISL250 Rotary PFS 8 Head With Zipper & Nitrogen", "product_code": "MACH-001", "category": "Machines", "quantity": 1.0, "uom": "SET", "rate": 1850000.0, "amount": 1850000.0},
            {"product_name": "AF1000T Automatic Liquid/Paste Filler Tube Sealer", "product_code": "MACH-004", "category": "Machines", "quantity": 1.0, "uom": "SET", "rate": 898194.0, "amount": 898194.0},
        ],
    },
    {
        "sr_no": 49,
        "transfer_no": "TRF-2026-049",
        "transfer_date": "12-09-2026 06:35 PM",
        "from_warehouse": "Mumbai",
        "to_warehouse": "Ahmedabad",
        "total_amount": 1175450.00,
        "added_by": "Akshata Wadekar",
        "status": "Received",
        "remarks": "Scheduled machine allocation for Gujarat distributor order",
        "items": [
            {"product_name": "XLSG36100 Capping Machine", "product_code": "MACH-003", "category": "Machines", "quantity": 2.0, "uom": "SET", "rate": 587725.0, "amount": 1175450.0},
        ],
    },
    {
        "sr_no": 48,
        "transfer_no": "TRF-2026-048",
        "transfer_date": "09-09-2026 04:03 PM",
        "from_warehouse": "Mumbai",
        "to_warehouse": "Ahmedabad",
        "total_amount": 94440.00,
        "added_by": "Akshata Wadekar",
        "status": "Received",
        "remarks": "Transfer of conveyor belts and sensor assemblies",
        "items": [
            {"product_name": "Conveyor Belt Replacement Roll 300mm", "product_code": "BELT-300", "category": "Spares", "quantity": 4.0, "uom": "PCS", "rate": 23610.0, "amount": 94440.0},
        ],
    },
    {
        "sr_no": 47,
        "transfer_no": "TRF-2026-047",
        "transfer_date": "01-09-2026 02:51 PM",
        "from_warehouse": "Ahmedabad",
        "to_warehouse": "Mumbai",
        "total_amount": 1993055.00,
        "added_by": "Akshata Wadekar",
        "status": "Received",
        "remarks": "Quarterly stock consolidation into central logistics warehouse",
        "items": [
            {"product_name": "Semi Automatic MAP Tray/Cup Sealing Machine", "product_code": "MACH-005", "category": "Machines", "quantity": 2.0, "uom": "SET", "rate": 996527.5, "amount": 1993055.0},
        ],
    },
    {
        "sr_no": 46,
        "transfer_no": "TRF-2026-046",
        "transfer_date": "01-09-2026 12:50 PM",
        "from_warehouse": "Mumbai",
        "to_warehouse": "Ahmedabad",
        "total_amount": 287821.00,
        "added_by": "Akshata Wadekar",
        "status": "Received",
        "remarks": "Flow wrap accessory shipment for client demonstration",
        "items": [
            {"product_name": "Infeed Chain Assembly 3.5M", "product_code": "CHN-35", "category": "Spares", "quantity": 2.0, "uom": "SET", "rate": 143910.5, "amount": 287821.0},
        ],
    },
    {
        "sr_no": 45,
        "transfer_no": "TRF-2026-045",
        "transfer_date": "22-08-2026 07:00 PM",
        "from_warehouse": "Indore",
        "to_warehouse": "Mumbai",
        "total_amount": 834428.00,
        "added_by": "Akshata Wadekar",
        "status": "Received",
        "remarks": "Pre-shipment inspection transfer",
        "items": [
            {"product_name": "PFFS200 Pneumatic Centre Sealer 240mm PLC", "product_code": "MACH-010", "category": "Machines", "quantity": 1.0, "uom": "SET", "rate": 834428.0, "amount": 834428.0},
        ],
    },
    {
        "sr_no": 44,
        "transfer_no": "TRF-2026-044",
        "transfer_date": "21-08-2026 11:35 AM",
        "from_warehouse": "Mumbai",
        "to_warehouse": "Indore",
        "total_amount": 97080.00,
        "added_by": "Akshata Wadekar",
        "status": "Received",
        "remarks": "Scheduled spares replenishment for central MP region",
        "items": [
            {"product_name": "Heater Cartridge 230V 500W", "product_code": "HEAT-500", "category": "Spares", "quantity": 20.0, "uom": "PCS", "rate": 4854.0, "amount": 97080.0},
        ],
    },
    {
        "sr_no": 43,
        "transfer_no": "TRF-2026-043",
        "transfer_date": "08-08-2026 02:26 PM",
        "from_warehouse": "Ahmedabad",
        "to_warehouse": "Mumbai",
        "total_amount": 12160.00,
        "added_by": "Akshata Wadekar",
        "status": "Received",
        "remarks": "Optical sensor emergency transfer",
        "items": [
            {"product_name": "Photoelectric Mark Sensor Banner", "product_code": "SEN-OPT-01", "category": "Spares", "quantity": 2.0, "uom": "PCS", "rate": 6080.0, "amount": 12160.0},
        ],
    },
]

# Add remaining records (31 Received, 3 Confirmed, 2 Cancel) to exactly reach 46 total
STATUS_CONFIGS = (
    [("Received", 31)] +
    [("Confirmed", 3)] +
    [("Cancel", 2)]
)

WAREHOUSE_PAIRS = [
    ("Mumbai", "Ahmedabad"),
    ("Ahmedabad", "Mumbai"),
    ("Indore", "Mumbai"),
    ("Mumbai", "Indore"),
    ("Ahmedabad", "Indore"),
    ("Indore", "Ahmedabad"),
]

curr_sr = 42
for st_label, st_count in STATUS_CONFIGS:
    for i in range(st_count):
        wh_from, wh_to = WAREHOUSE_PAIRS[curr_sr % len(WAREHOUSE_PAIRS)]
        amount = round(15000.0 + (curr_sr * 12450.75) % 850000.0, 2)
        day = max(1, (curr_sr % 28) + 1)
        month = "08" if curr_sr < 25 else "07"
        SEED_TRANSFERS.append({
            "sr_no": curr_sr,
            "transfer_no": f"TRF-2026-{curr_sr:03d}",
            "transfer_date": f"{day:02d}-{month}-2026 11:30 AM",
            "from_warehouse": wh_from,
            "to_warehouse": wh_to,
            "total_amount": amount,
            "added_by": "Akshata Wadekar",
            "status": st_label,
            "remarks": f"Warehouse stock transfer batch #{curr_sr} ({st_label})",
            "items": [
                {
                    "product_name": f"Packaging Line Equipment Module {curr_sr}",
                    "product_code": f"PLM-{curr_sr:03d}",
                    "category": "Machines" if curr_sr % 2 == 0 else "Spares",
                    "quantity": 1.0,
                    "uom": "SET",
                    "rate": amount,
                    "amount": amount,
                }
            ],
        })
        curr_sr -= 1


def upgrade() -> None:
    # 1. Create stock_transfers table
    op.create_table(
        'stock_transfers',
        sa.Column('id', app.database.base.GUID(), nullable=False),
        sa.Column('sr_no', sa.Integer(), nullable=False),
        sa.Column('transfer_no', sa.String(length=50), nullable=False),
        sa.Column('transfer_date', sa.String(length=50), nullable=False),
        sa.Column('from_warehouse', sa.String(length=100), nullable=False),
        sa.Column('to_warehouse', sa.String(length=100), nullable=False),
        sa.Column('total_amount', sa.Float(), server_default='0', nullable=False),
        sa.Column('added_by', sa.String(length=100), server_default='Akshata Wadekar', nullable=False),
        sa.Column('status', sa.String(length=50), server_default='Received', nullable=False),
        sa.Column('remarks', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('version', sa.Integer(), server_default='1', nullable=False),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_stock_transfers'))
    )
    op.create_index(op.f('ix_stock_transfers_sr_no'), 'stock_transfers', ['sr_no'], unique=False)
    op.create_index(op.f('ix_stock_transfers_transfer_no'), 'stock_transfers', ['transfer_no'], unique=True)
    op.create_index(op.f('ix_stock_transfers_from_warehouse'), 'stock_transfers', ['from_warehouse'], unique=False)
    op.create_index(op.f('ix_stock_transfers_to_warehouse'), 'stock_transfers', ['to_warehouse'], unique=False)
    op.create_index(op.f('ix_stock_transfers_status'), 'stock_transfers', ['status'], unique=False)

    # 2. Create stock_transfer_items table
    op.create_table(
        'stock_transfer_items',
        sa.Column('id', app.database.base.GUID(), nullable=False),
        sa.Column('transfer_id', app.database.base.GUID(), nullable=False),
        sa.Column('product_name', sa.String(length=255), nullable=False),
        sa.Column('product_code', sa.String(length=100), nullable=True),
        sa.Column('category', sa.String(length=100), nullable=True),
        sa.Column('quantity', sa.Float(), server_default='1', nullable=False),
        sa.Column('uom', sa.String(length=50), server_default='SET', nullable=False),
        sa.Column('rate', sa.Float(), server_default='0', nullable=False),
        sa.Column('amount', sa.Float(), server_default='0', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['transfer_id'], ['stock_transfers.id'], name=op.f('fk_stock_transfer_items_transfer_id_stock_transfers'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_stock_transfer_items'))
    )
    op.create_index(op.f('ix_stock_transfer_items_transfer_id'), 'stock_transfer_items', ['transfer_id'], unique=False)

    # 3. Seed records
    conn = op.get_bind()
    for row in SEED_TRANSFERS:
        t_id = uuid.uuid4()
        items = row.get("items", [])
        conn.execute(
            sa.text(
                """
                INSERT INTO stock_transfers (id, sr_no, transfer_no, transfer_date, from_warehouse, to_warehouse, total_amount, added_by, status, remarks, version)
                VALUES (:id, :sr_no, :transfer_no, :transfer_date, :from_warehouse, :to_warehouse, :total_amount, :added_by, :status, :remarks, 1)
                """
            ),
            {
                "id": t_id,
                "sr_no": row["sr_no"],
                "transfer_no": row["transfer_no"],
                "transfer_date": row["transfer_date"],
                "from_warehouse": row["from_warehouse"],
                "to_warehouse": row["to_warehouse"],
                "total_amount": row["total_amount"],
                "added_by": row["added_by"],
                "status": row["status"],
                "remarks": row.get("remarks", ""),
            },
        )
        for item in items:
            conn.execute(
                sa.text(
                    """
                    INSERT INTO stock_transfer_items (id, transfer_id, product_name, product_code, category, quantity, uom, rate, amount)
                    VALUES (:id, :transfer_id, :product_name, :product_code, :category, :quantity, :uom, :rate, :amount)
                    """
                ),
                {
                    "id": uuid.uuid4(),
                    "transfer_id": t_id,
                    "product_name": item["product_name"],
                    "product_code": item.get("product_code", "-"),
                    "category": item.get("category", "Machines"),
                    "quantity": item["quantity"],
                    "uom": item.get("uom", "SET"),
                    "rate": item["rate"],
                    "amount": item["amount"],
                },
            )


def downgrade() -> None:
    op.drop_table('stock_transfer_items')
    op.drop_table('stock_transfers')
