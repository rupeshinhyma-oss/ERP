"""
Pydantic Schemas for Inventory Modules:
- Product Stock (warehouse inventory levels, batch tracking, stock visibility)
- Stock Adjustment (Stock IN / OUT reconciliations, client returns, damage, split, PDF export)
"""

from __future__ import annotations

from typing import Any, List, Optional
from pydantic import BaseModel, Field, model_validator


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

    @model_validator(mode="before")
    @classmethod
    def normalize_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "product_name" not in data and "item_name" in data:
                data["product_name"] = data["item_name"]
            if "qty" not in data and "quantity" in data:
                data["qty"] = data["quantity"]
            if "rate" not in data and "unit_price" in data:
                data["rate"] = data["unit_price"]
            if "amount" not in data:
                if "total_price" in data:
                    data["amount"] = data["total_price"]
                elif "qty" in data and "rate" in data:
                    data["amount"] = float(data["qty"]) * float(data["rate"])
            if "hsn_code" not in data and "hsn" in data:
                data["hsn_code"] = data["hsn"]
            if "gst_rate" not in data and "gst" in data:
                data["gst_rate"] = data["gst"]
            if "uom" not in data:
                data["uom"] = "SET"
        return data


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

    @model_validator(mode="before")
    @classmethod
    def normalize_adjustment_type(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "type" not in data and "adjustment_type" in data:
                raw_type = str(data["adjustment_type"]).upper()
                if "IN" in raw_type:
                    data["type"] = "Stock IN"
                elif "OUT" in raw_type:
                    data["type"] = "Stock OUT"
                else:
                    data["type"] = data["adjustment_type"]
        return data


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


# ==============================================================================
# Stock Transfer Schemas
# ==============================================================================

class StockTransferLineItemSchema(BaseModel):
    """Line item belonging to a stock transfer."""
    id: Optional[str] = None
    product_name: str
    product_code: Optional[str] = "-"
    category: Optional[str] = "Machines"
    quantity: float = Field(1.0, gt=0)
    uom: str = "SET"
    rate: float = Field(0.0, ge=0)
    amount: float = Field(0.0, ge=0)


class StockTransferCreate(BaseModel):
    """Payload to record a new stock transfer."""
    transfer_date: str = Field(..., description="Date and time string (e.g. '18-09-2026 04:37 PM')")
    from_warehouse: str = Field(..., description="Origin warehouse")
    to_warehouse: str = Field(..., description="Destination warehouse")
    total_amount: Optional[float] = Field(None, description="Grand total amount")
    added_by: str = Field("Akshata Wadekar", description="User who recorded the transfer")
    status: str = Field("Received", description="'Received' | 'Pending' | 'Confirmed' | 'Cancel'")
    remarks: Optional[str] = None
    items: List[StockTransferLineItemSchema] = Field(default_factory=list)


class StockTransferRead(BaseModel):
    """Full stock transfer record schema."""
    id: str
    sr_no: int
    transfer_no: str
    transfer_date: str
    from_warehouse: str
    to_warehouse: str
    total_amount: float
    added_by: str
    status: str
    remarks: Optional[str] = None
    items: List[StockTransferLineItemSchema] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class StockTransferTabCounts(BaseModel):
    """Count of stock transfers across status tabs."""
    all: int = 0
    pending: int = 0
    confirmed: int = 0
    received: int = 0
    cancel: int = 0


class StockTransferUpdateStatus(BaseModel):
    """Payload to update stock transfer status."""
    status: str = Field(..., description="'Received' | 'Pending' | 'Confirmed' | 'Cancel'")
