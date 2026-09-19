"""create_inventory_and_stock_adjustment_tables

Revision ID: e2f3a4b5c6d7
Revises: c1d2e3f4a5b6
Create Date: 2026-09-19 14:15:00.000000

"""
import uuid
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import app.database.base

# revision identifiers, used by Alembic.
revision: str = 'e2f3a4b5c6d7'
down_revision: Union[str, None] = 'c1d2e3f4a5b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


SEED_STOCK_ITEMS = [
    {
        "id": str(uuid.uuid4()),
        "sr_no": 1,
        "product_name_tally": "Sensor (Banding)",
        "product_code": "-",
        "brand": "-",
        "category": "Spares",
        "sub_category": "Spares For Banding Machine",
        "hsn_code": "84229090",
        "gst_rate": "18%",
        "mumbai": 1.0,
        "mumbai_transit": 0.0,
        "mumbai_ordered": 0.0,
        "ahmedabad": 0.0,
        "ahmedabad_transit": 0.0,
        "ahmedabad_ordered": 0.0,
        "indore": 0.0,
        "indore_transit": 0.0,
        "indore_ordered": 0.0,
        "total_qty": 1.0,
        "uom": "PCS",
        "description": "Sensor spare component for Banding Machine",
        "status": "In Stock",
    },
    {
        "id": str(uuid.uuid4()),
        "sr_no": 2,
        "product_name_tally": "ISL250 Rotary PFS 8 Head With Zipper & Nitrogen",
        "product_code": "-",
        "brand": "Yinglima",
        "category": "Machines",
        "sub_category": "Miscellaneous",
        "hsn_code": "84224000",
        "gst_rate": "18%",
        "mumbai": 0.0,
        "mumbai_transit": 0.0,
        "mumbai_ordered": 1.0,
        "ahmedabad": 0.0,
        "ahmedabad_transit": 0.0,
        "ahmedabad_ordered": 0.0,
        "indore": 0.0,
        "indore_transit": 0.0,
        "indore_ordered": 0.0,
        "total_qty": 1.0,
        "uom": "SET",
        "description": "ISL250 Rotary Premade Pouch Fill Seal 8 Head with Zipper and Nitrogen flushing system",
        "status": "In Stock",
    },
    {
        "id": str(uuid.uuid4()),
        "sr_no": 3,
        "product_name_tally": "XLSG36100 Capping Machine",
        "product_code": "-",
        "brand": "Yinglima",
        "category": "Machines",
        "sub_category": "Capping Machine",
        "hsn_code": "84223000",
        "gst_rate": "18%",
        "mumbai": 0.0,
        "mumbai_transit": 0.0,
        "mumbai_ordered": 4.0,
        "ahmedabad": 0.0,
        "ahmedabad_transit": 0.0,
        "ahmedabad_ordered": 0.0,
        "indore": 0.0,
        "indore_transit": 0.0,
        "indore_ordered": 0.0,
        "total_qty": 4.0,
        "uom": "SET",
        "description": "XLSG36100 Automatic Inline Capping Machine with Cap Feeder",
        "status": "In Stock",
    },
    {
        "id": str(uuid.uuid4()),
        "sr_no": 4,
        "product_name_tally": "Automatic Tube Filling & Sealing Machine",
        "product_code": "-",
        "brand": "Yinglima",
        "category": "Machines",
        "sub_category": "Tube Sealer",
        "hsn_code": "84223000",
        "gst_rate": "18%",
        "mumbai": 0.0,
        "mumbai_transit": 0.0,
        "mumbai_ordered": 1.0,
        "ahmedabad": 0.0,
        "ahmedabad_transit": 0.0,
        "ahmedabad_ordered": 0.0,
        "indore": 0.0,
        "indore_transit": 0.0,
        "indore_ordered": 0.0,
        "total_qty": 1.0,
        "uom": "SET",
        "description": "Automatic Tube Filling and Ultrasonic Sealing Machine for laminate and plastic tubes",
        "status": "In Stock",
    },
    {
        "id": str(uuid.uuid4()),
        "sr_no": 5,
        "product_name_tally": "Semi Automatic MAP (Vacuum + 2 Gases) Tray/Cup Sealing Machine",
        "product_code": "-",
        "brand": "Yinglima",
        "category": "Machines",
        "sub_category": "Vacuum Sealer Machine",
        "hsn_code": "84224000",
        "gst_rate": "18%",
        "mumbai": 0.0,
        "mumbai_transit": 0.0,
        "mumbai_ordered": 1.0,
        "ahmedabad": 0.0,
        "ahmedabad_transit": 0.0,
        "ahmedabad_ordered": 0.0,
        "indore": 0.0,
        "indore_transit": 0.0,
        "indore_ordered": 0.0,
        "total_qty": 1.0,
        "uom": "SET",
        "description": "Modified Atmosphere Packaging Tray Sealer with gas flushing capabilities",
        "status": "In Stock",
    },
]

SEED_ADJUSTMENTS = [
    {
        "id": str(uuid.uuid4()),
        "adjustment_no": "492",
        "adjustment_date": "19-09-2026",
        "client_name": "GARUDA ENGINEERS",
        "invoice_no": "660/26-27",
        "warehouse": "Ahmedabad",
        "type": "Stock IN",
        "purpose": "Return From Client",
        "total_amount": 275000.0,
        "created_by": "Akshata Wadekar",
        "remarks": "Party required another machine, but salesperson give the other machine",
        "items": [
            {
                "product_name": "ISL450XDAN Flow Wrap machine w/o end seal chain",
                "product_code": "MACH-002",
                "category": "Machines",
                "hsn_code": "84224000",
                "gst_rate": "18%",
                "quantity": 1.0,
                "uom": "SET",
                "rate": 275000.0,
                "amount": 275000.0,
            }
        ],
    },
    {
        "id": str(uuid.uuid4()),
        "adjustment_no": "491",
        "adjustment_date": "18-09-2026",
        "client_name": None,
        "invoice_no": None,
        "warehouse": "Ahmedabad",
        "type": "Stock IN",
        "purpose": "Split",
        "total_amount": 61250.0,
        "created_by": "Akshata Wadekar",
        "remarks": "Stock inward from split batch 09-AHM",
        "items": [
            {
                "product_name": "XLSG36100 Capping Machine Spares",
                "product_code": "SPR-003",
                "category": "Spares",
                "hsn_code": "84229090",
                "gst_rate": "18%",
                "quantity": 5.0,
                "uom": "PCS",
                "rate": 12250.0,
                "amount": 61250.0,
            }
        ],
    },
    {
        "id": str(uuid.uuid4()),
        "adjustment_no": "490",
        "adjustment_date": "18-09-2026",
        "client_name": None,
        "invoice_no": None,
        "warehouse": "Ahmedabad",
        "type": "Stock OUT",
        "purpose": "Split",
        "total_amount": 61250.0,
        "created_by": "Akshata Wadekar",
        "remarks": "Stock outward to component sub-assemblies",
        "items": [
            {
                "product_name": "XLSG36100 Assembly Unit",
                "product_code": "ASSM-003",
                "category": "Machines",
                "hsn_code": "84223000",
                "gst_rate": "18%",
                "quantity": 1.0,
                "uom": "SET",
                "rate": 61250.0,
                "amount": 61250.0,
            }
        ],
    },
    {
        "id": str(uuid.uuid4()),
        "adjustment_no": "489",
        "adjustment_date": "17-09-2026",
        "client_name": None,
        "invoice_no": None,
        "warehouse": "Mumbai",
        "type": "Stock IN",
        "purpose": "Split",
        "total_amount": 10708.0,
        "created_by": "Akshata Wadekar",
        "remarks": "Stock inward split for packaging sub-assembly",
        "items": [
            {
                "product_name": "Automatic Liquid Nitrogen Dosing System",
                "product_code": "DOS-001",
                "category": "Machines",
                "hsn_code": "84224000",
                "gst_rate": "18%",
                "quantity": 1.0,
                "uom": "SET",
                "rate": 10708.0,
                "amount": 10708.0,
            }
        ],
    },
    {
        "id": str(uuid.uuid4()),
        "adjustment_no": "488",
        "adjustment_date": "17-09-2026",
        "client_name": None,
        "invoice_no": None,
        "warehouse": "Mumbai",
        "type": "Stock OUT",
        "purpose": "Damage",
        "total_amount": 225000.0,
        "created_by": "Akshata Wadekar",
        "remarks": "Damage in transport from Mundra Port to Bhiwandi warehouse",
        "items": [
            {
                "product_name": "Automatic Auger Powder Filling Machine",
                "product_code": "MACH-005",
                "category": "Machines",
                "hsn_code": "84223000",
                "gst_rate": "18%",
                "quantity": 1.0,
                "uom": "SET",
                "rate": 225000.0,
                "amount": 225000.0,
            }
        ],
    },
    {
        "id": str(uuid.uuid4()),
        "adjustment_no": "487",
        "adjustment_date": "17-09-2026",
        "client_name": None,
        "invoice_no": None,
        "warehouse": "Mumbai",
        "type": "Stock IN",
        "purpose": "Split",
        "total_amount": 73500.0,
        "created_by": "Akshata Wadekar",
        "remarks": "Stock inward split for packaging sub-assembly",
        "items": [
            {
                "product_name": "AF1000T Auto Auger Filler Conveyor 30LTR Spares",
                "product_code": "SPR-007",
                "category": "Spares",
                "hsn_code": "84229090",
                "gst_rate": "18%",
                "quantity": 2.0,
                "uom": "SET",
                "rate": 36750.0,
                "amount": 73500.0,
            }
        ],
    },
    {
        "id": str(uuid.uuid4()),
        "adjustment_no": "486",
        "adjustment_date": "17-09-2026",
        "client_name": None,
        "invoice_no": None,
        "warehouse": "Mumbai",
        "type": "Stock OUT",
        "purpose": "Split",
        "total_amount": 73500.0,
        "created_by": "Akshata Wadekar",
        "remarks": "Outward adjustment split for packaging conversion",
        "items": [
            {
                "product_name": "AF1000T Sub-assembly Module",
                "product_code": "ASSM-007",
                "category": "Machines",
                "hsn_code": "84223000",
                "gst_rate": "18%",
                "quantity": 1.0,
                "uom": "SET",
                "rate": 73500.0,
                "amount": 73500.0,
            }
        ],
    },
    {
        "id": str(uuid.uuid4()),
        "adjustment_no": "485",
        "adjustment_date": "15-09-2026",
        "client_name": "SLEXO PACKAGING",
        "invoice_no": "3288/26-27",
        "warehouse": "Mumbai",
        "type": "Stock IN",
        "purpose": "Return From Client",
        "total_amount": 26000.0,
        "created_by": "Akshata Wadekar",
        "remarks": "Return from customer demo consignment",
        "items": [
            {
                "product_name": "Sensor (Banding) & Heating Elements",
                "product_code": "SEN-001B",
                "category": "Spares",
                "hsn_code": "84229090",
                "gst_rate": "18%",
                "quantity": 4.0,
                "uom": "PCS",
                "rate": 6500.0,
                "amount": 26000.0,
            }
        ],
    },
    {
        "id": str(uuid.uuid4()),
        "adjustment_no": "484",
        "adjustment_date": "15-09-2026",
        "client_name": None,
        "invoice_no": None,
        "warehouse": "Ahmedabad",
        "type": "Stock IN",
        "purpose": "Split",
        "total_amount": 105000.0,
        "created_by": "Akshata Wadekar",
        "remarks": "Stock inward split for packaging sub-assembly",
        "items": [
            {
                "product_name": "Packaging Line Conveyor Belt & Assembly",
                "product_code": "CONV-001",
                "category": "Machines",
                "hsn_code": "84223000",
                "gst_rate": "18%",
                "quantity": 1.0,
                "uom": "SET",
                "rate": 105000.0,
                "amount": 105000.0,
            }
        ],
    },
    {
        "id": str(uuid.uuid4()),
        "adjustment_no": "483",
        "adjustment_date": "15-09-2026",
        "client_name": None,
        "invoice_no": None,
        "warehouse": "Ahmedabad",
        "type": "Stock OUT",
        "purpose": "Split",
        "total_amount": 105000.0,
        "created_by": "Akshata Wadekar",
        "remarks": "Stock outward split for assembly transfer",
        "items": [
            {
                "product_name": "Packaging Line Conveyor Belt & Assembly",
                "product_code": "CONV-001",
                "category": "Machines",
                "hsn_code": "84223000",
                "gst_rate": "18%",
                "quantity": 1.0,
                "uom": "SET",
                "rate": 105000.0,
                "amount": 105000.0,
            }
        ],
    },
    {
        "id": str(uuid.uuid4()),
        "adjustment_no": "482",
        "adjustment_date": "12-09-2026",
        "client_name": None,
        "invoice_no": None,
        "warehouse": "Mumbai",
        "type": "Stock IN",
        "purpose": "Split",
        "total_amount": 347349.0,
        "created_by": "Akshata Wadekar",
        "remarks": "Stock inward split for packaging sub-assembly",
        "items": [
            {
                "product_name": "Automatic Liquid Nitrogen Dosing System",
                "product_code": "DOS-002",
                "category": "Machines",
                "hsn_code": "84224000",
                "gst_rate": "18%",
                "quantity": 1.0,
                "uom": "SET",
                "rate": 347349.0,
                "amount": 347349.0,
            }
        ],
    },
]


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # 1. Table: product_stocks
    if not insp.has_table('product_stocks'):
        op.create_table(
            'product_stocks',
            sa.Column('id', app.database.base.GUID(), primary_key=True),
            sa.Column('sr_no', sa.Integer(), nullable=True),
            sa.Column('product_id', app.database.base.GUID(), nullable=True),
            sa.Column('product_name_tally', sa.String(255), nullable=False),
            sa.Column('product_code', sa.String(100), server_default='-', nullable=False),
            sa.Column('brand', sa.String(100), server_default='-', nullable=False),
            sa.Column('category', sa.String(100), nullable=True),
            sa.Column('sub_category', sa.String(100), nullable=True),
            sa.Column('hsn_code', sa.String(50), nullable=True),
            sa.Column('gst_rate', sa.String(20), server_default='18%', nullable=True),
            sa.Column('mumbai', sa.Float(), server_default='0', nullable=False),
            sa.Column('mumbai_transit', sa.Float(), server_default='0', nullable=False),
            sa.Column('mumbai_ordered', sa.Float(), server_default='0', nullable=False),
            sa.Column('ahmedabad', sa.Float(), server_default='0', nullable=False),
            sa.Column('ahmedabad_transit', sa.Float(), server_default='0', nullable=False),
            sa.Column('ahmedabad_ordered', sa.Float(), server_default='0', nullable=False),
            sa.Column('indore', sa.Float(), server_default='0', nullable=False),
            sa.Column('indore_transit', sa.Float(), server_default='0', nullable=False),
            sa.Column('indore_ordered', sa.Float(), server_default='0', nullable=False),
            sa.Column('total_qty', sa.Float(), server_default='0', nullable=False),
            sa.Column('uom', sa.String(50), server_default='SET', nullable=False),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('orders_info', sa.JSON(), nullable=True),
            sa.Column('status', sa.String(50), server_default='In Stock', nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
            sa.Column('version', sa.Integer(), server_default='1', nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index(op.f('ix_product_stocks_product_name_tally'), 'product_stocks', ['product_name_tally'], unique=False)
        op.create_index(op.f('ix_product_stocks_category'), 'product_stocks', ['category'], unique=False)
        op.create_index(op.f('ix_product_stocks_sub_category'), 'product_stocks', ['sub_category'], unique=False)
        op.create_index(op.f('ix_product_stocks_status'), 'product_stocks', ['status'], unique=False)

        # Seed initial product stock items
        product_stocks_table = sa.table(
            'product_stocks',
            sa.column('id', app.database.base.GUID()),
            sa.column('sr_no', sa.Integer()),
            sa.column('product_name_tally', sa.String()),
            sa.column('product_code', sa.String()),
            sa.column('brand', sa.String()),
            sa.column('category', sa.String()),
            sa.column('sub_category', sa.String()),
            sa.column('hsn_code', sa.String()),
            sa.column('gst_rate', sa.String()),
            sa.column('mumbai', sa.Float()),
            sa.column('mumbai_transit', sa.Float()),
            sa.column('mumbai_ordered', sa.Float()),
            sa.column('ahmedabad', sa.Float()),
            sa.column('ahmedabad_transit', sa.Float()),
            sa.column('ahmedabad_ordered', sa.Float()),
            sa.column('indore', sa.Float()),
            sa.column('indore_transit', sa.Float()),
            sa.column('indore_ordered', sa.Float()),
            sa.column('total_qty', sa.Float()),
            sa.column('uom', sa.String()),
            sa.column('description', sa.Text()),
            sa.column('status', sa.String()),
        )
        op.bulk_insert(product_stocks_table, SEED_STOCK_ITEMS)

    # 2. Table: stock_adjustments
    if not insp.has_table('stock_adjustments'):
        op.create_table(
            'stock_adjustments',
            sa.Column('id', app.database.base.GUID(), primary_key=True),
            sa.Column('adjustment_no', sa.String(50), nullable=True),
            sa.Column('adjustment_date', sa.String(50), nullable=False),
            sa.Column('client_name', sa.String(255), nullable=True),
            sa.Column('invoice_no', sa.String(100), nullable=True),
            sa.Column('warehouse', sa.String(100), nullable=False),
            sa.Column('type', sa.String(50), nullable=False),
            sa.Column('purpose', sa.String(100), nullable=False),
            sa.Column('total_amount', sa.Float(), server_default='0', nullable=False),
            sa.Column('created_by', sa.String(100), server_default='Admin User', nullable=False),
            sa.Column('remarks', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
            sa.Column('version', sa.Integer(), server_default='1', nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index(op.f('ix_stock_adjustments_adjustment_no'), 'stock_adjustments', ['adjustment_no'], unique=False)
        op.create_index(op.f('ix_stock_adjustments_adjustment_date'), 'stock_adjustments', ['adjustment_date'], unique=False)
        op.create_index(op.f('ix_stock_adjustments_client_name'), 'stock_adjustments', ['client_name'], unique=False)
        op.create_index(op.f('ix_stock_adjustments_warehouse'), 'stock_adjustments', ['warehouse'], unique=False)
        op.create_index(op.f('ix_stock_adjustments_type'), 'stock_adjustments', ['type'], unique=False)
        op.create_index(op.f('ix_stock_adjustments_purpose'), 'stock_adjustments', ['purpose'], unique=False)

    # 3. Table: stock_adjustment_items
    if not insp.has_table('stock_adjustment_items'):
        op.create_table(
            'stock_adjustment_items',
            sa.Column('id', app.database.base.GUID(), primary_key=True),
            sa.Column('adjustment_id', app.database.base.GUID(), sa.ForeignKey('stock_adjustments.id', ondelete='CASCADE'), nullable=False),
            sa.Column('product_id', sa.String(64), nullable=True),
            sa.Column('product_name', sa.String(255), nullable=False),
            sa.Column('product_code', sa.String(100), nullable=True),
            sa.Column('category', sa.String(100), nullable=True),
            sa.Column('hsn_code', sa.String(50), nullable=True),
            sa.Column('gst_rate', sa.String(20), server_default='18%', nullable=True),
            sa.Column('quantity', sa.Float(), server_default='1', nullable=False),
            sa.Column('uom', sa.String(50), server_default='SET', nullable=False),
            sa.Column('rate', sa.Float(), server_default='0', nullable=False),
            sa.Column('amount', sa.Float(), server_default='0', nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
        )
        op.create_index(op.f('ix_stock_adjustment_items_adjustment_id'), 'stock_adjustment_items', ['adjustment_id'], unique=False)
        op.create_index(op.f('ix_stock_adjustment_items_product_name'), 'stock_adjustment_items', ['product_name'], unique=False)

        # Seed initial adjustments and line items
        stock_adjustments_table = sa.table(
            'stock_adjustments',
            sa.column('id', app.database.base.GUID()),
            sa.column('adjustment_no', sa.String()),
            sa.column('adjustment_date', sa.String()),
            sa.column('client_name', sa.String()),
            sa.column('invoice_no', sa.String()),
            sa.column('warehouse', sa.String()),
            sa.column('type', sa.String()),
            sa.column('purpose', sa.String()),
            sa.column('total_amount', sa.Float()),
            sa.column('created_by', sa.String()),
            sa.column('remarks', sa.Text()),
        )
        stock_items_table = sa.table(
            'stock_adjustment_items',
            sa.column('id', app.database.base.GUID()),
            sa.column('adjustment_id', app.database.base.GUID()),
            sa.column('product_name', sa.String()),
            sa.column('product_code', sa.String()),
            sa.column('category', sa.String()),
            sa.column('hsn_code', sa.String()),
            sa.column('gst_rate', sa.String()),
            sa.column('quantity', sa.Float()),
            sa.column('uom', sa.String()),
            sa.column('rate', sa.Float()),
            sa.column('amount', sa.Float()),
        )

        adj_rows = []
        item_rows = []
        for a in SEED_ADJUSTMENTS:
            adj_id = a["id"]
            adj_rows.append({
                "id": adj_id,
                "adjustment_no": a["adjustment_no"],
                "adjustment_date": a["adjustment_date"],
                "client_name": a["client_name"],
                "invoice_no": a["invoice_no"],
                "warehouse": a["warehouse"],
                "type": a["type"],
                "purpose": a["purpose"],
                "total_amount": a["total_amount"],
                "created_by": a["created_by"],
                "remarks": a["remarks"],
            })
            for item in a.get("items", []):
                item_rows.append({
                    "id": str(uuid.uuid4()),
                    "adjustment_id": adj_id,
                    "product_name": item["product_name"],
                    "product_code": item["product_code"],
                    "category": item["category"],
                    "hsn_code": item["hsn_code"],
                    "gst_rate": item["gst_rate"],
                    "quantity": item["quantity"],
                    "uom": item["uom"],
                    "rate": item["rate"],
                    "amount": item["amount"],
                })

        if adj_rows:
            op.bulk_insert(stock_adjustments_table, adj_rows)
        if item_rows:
            op.bulk_insert(stock_items_table, item_rows)


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table('stock_adjustment_items'):
        op.drop_table('stock_adjustment_items')
    if insp.has_table('stock_adjustments'):
        op.drop_table('stock_adjustments')
    if insp.has_table('product_stocks'):
        op.drop_table('product_stocks')
