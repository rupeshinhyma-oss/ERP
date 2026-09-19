"""
Pydantic Schemas for Inventory Modules:
- Product Stock (warehouse inventory levels, batch tracking, stock visibility)
- Stock Adjustment (Stock IN / OUT reconciliations, client returns, damage, split, PDF export)
"""

from __future__ import annotations

from typing import List, Optional
from pydantic import BaseModel, Field


# ==============================================================================
# Product Stock Schemas
# ==============================================================================

class ProductStockItemRead(BaseModel):
    """Product stock inventory record."""
    id: str = Field(..., description="Unique product stock identifier")
    product_name: str = Field(..., description="Full descriptive name of the product or equipment")
    product_code: str = Field(..., description="SKU or product master code")
    category: str = Field(..., description="Product category (e.g. Machines, Spares, Consumables)")
    sub_category: Optional[str] = Field(None, description="Sub-category classification")
    brand: Optional[str] = Field(None, description="Manufacturer or brand name")
    warehouse: str = Field(..., description="Warehouse location (e.g. Ahmedabad, Mumbai)")
    quantity_on_hand: float = Field(..., ge=0, description="Physical inventory count on hand")
    quantity_available: float = Field(..., ge=0, description="Available count (on hand minus reserved)")
    quantity_reserved: float = Field(0.0, ge=0, description="Quantity locked for pending consignments")
    uom: str = Field("SET", description="Unit of measurement (SET, PCS, NOS, KGS)")
    unit_cost: Optional[float] = Field(None, ge=0, description="Cost per unit in INR")
    total_value: Optional[float] = Field(None, ge=0, description="Total inventory valuation")
    status: str = Field("In Stock", description="Stock status (In Stock, Low Stock, Out of Stock)")

    model_config = {"from_attributes": True}


class ProductStockFilterParams(BaseModel):
    """Query parameters for filtering product stock."""
    warehouse: Optional[str] = None
    category: Optional[str] = None
    brand: Optional[str] = None
    status: Optional[str] = None
    search: Optional[str] = None
    skip: int = Field(0, ge=0)
    limit: int = Field(50, ge=1, le=500)


# ==============================================================================
# Stock Adjustment Schemas
# ==============================================================================

class StockAdjustmentLineItemSchema(BaseModel):
    """Individual line item included within a stock adjustment."""
    product_name: str = Field(..., description="Product or assembly name")
    product_code: Optional[str] = Field(None, description="Product code / SKU")
    category: Optional[str] = Field("Machines", description="Category classification")
    hsn_code: Optional[str] = Field("84224000", description="HSN classification code")
    gst_rate: Optional[str] = Field("18%", description="Applicable GST rate percentage")
    qty: float = Field(..., gt=0, description="Adjusted quantity")
    uom: str = Field("SET", description="Unit of measurement")
    rate: float = Field(..., ge=0, description="Rate / unit price in INR")
    amount: float = Field(..., ge=0, description="Total amount (qty * rate)")


class StockAdjustmentCreate(BaseModel):
    """Payload to record a new stock adjustment."""
    adjustment_no: Optional[str] = Field(None, description="Custom or legacy adjustment order number")
    adjustment_date: str = Field(..., description="Adjustment date in DD-MM-YYYY or ISO format")
    client_name: Optional[str] = Field(None, description="Associated client/buyer name")
    invoice_no: Optional[str] = Field(None, description="Associated invoice number")
    warehouse: str = Field(..., description="Warehouse where inventory is adjusted")
    type: str = Field(..., description="Adjustment type: 'Stock IN' or 'Stock OUT'")
    purpose: str = Field(..., description="Purpose: 'Return From Client', 'Split', 'Damage'")
    remarks: Optional[str] = Field(None, description="Detailed reasons or inspection remarks")
    items: List[StockAdjustmentLineItemSchema] = Field(..., min_length=1, description="Line items adjusted")


class StockAdjustmentRead(BaseModel):
    """Stock adjustment response schema."""
    id: str = Field(..., description="Adjustment record identifier")
    adjustment_no: Optional[str] = Field(None, description="Adjustment order number (e.g. '492')")
    adjustment_date: str = Field(..., description="Adjustment date (DD-MM-YYYY)")
    client_name: Optional[str] = None
    invoice_no: Optional[str] = None
    warehouse: str
    type: str = Field(..., description="'Stock IN' | 'Stock OUT'")
    purpose: str = Field(..., description="'Return From Client' | 'Split' | 'Damage'")
    total_amount: float = Field(..., description="Sum total amount across line items")
    created_by: str = Field("Admin User", description="User who initiated the adjustment")
    created_at: str = Field(..., description="Creation date timestamp")
    remarks: Optional[str] = None
    items: List[StockAdjustmentLineItemSchema] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class StockAdjustmentFilterParams(BaseModel):
    """Filter parameters for stock adjustments list."""
    date_range: Optional[str] = Field(None, description="Date range: 'MM/DD/YYYY - MM/DD/YYYY'")
    type: Optional[str] = Field(None, description="'Stock IN' | 'Stock OUT' | 'All'")
    purpose: Optional[str] = Field(None, description="'Return From Client' | 'Split' | 'Damage' | 'All'")
    warehouse: Optional[str] = Field(None, description="Warehouse filter or 'All'")
    search: Optional[str] = Field(None, description="Search term for client, invoice, product, warehouse")
    skip: int = Field(0, ge=0)
    limit: int = Field(50, ge=1, le=500)
