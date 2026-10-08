"""Product Pydantic Schemas (request/response contracts)."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator

from app.core.constants import RecordStatus


class TaxRefRead(BaseModel):
    """Minimal read-only view of the linked Taxes-master row (HSN Number / GST % / Import Duty %)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    hsn_number: str
    gst_percent: float
    import_duty_percent: float


def compute_client_cbm(length: float | None, width: float | None, height: float | None) -> float:
    """Compute CBM rounded to 2 decimal places using client rounding rule:
    <= 0.025 -> 0.02, 0.026 - 0.029 -> 0.03.
    """
    if length is None or width is None or height is None:
        return 0.0
    try:
        l, w, h = float(length), float(width), float(height)
    except (ValueError, TypeError):
        return 0.0
    if l <= 0 or w <= 0 or h <= 0:
        return 0.0
    raw = (l * w * h) / 1_000_000.0
    scaled = raw * 100.0
    int_part = int(scaled)
    rem = scaled - int_part
    cbm = (int_part / 100.0) if rem <= 0.500001 else ((int_part + 1) / 100.0)
    return round(cbm, 2)


class ProductDimensionRowIn(BaseModel):
    """One row of the "Dimensions" table, as submitted by the Add/Edit form."""

    id: str | None = None  # Client-generated row id; ignored on write, just echoed back
    package_name: str | None = Field(default=None, max_length=255)
    title: str | None = Field(default=None, max_length=255)
    length: float | None = Field(default=None, ge=0)
    width: float | None = Field(default=None, ge=0)
    height: float | None = Field(default=None, ge=0)
    cbm: float | None = Field(default=None, ge=0)
    net_weight: float | None = Field(default=None, ge=0)
    gross_weight: float | None = Field(default=None, ge=0)


class ProductDimensionRowRead(BaseModel):
    """One row of the "Dimensions" table, as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    package_name: str | None = None
    title: str | None = None
    length: float | None = None
    width: float | None = None
    height: float | None = None
    cbm: float | None = None
    net_weight: float | None = None
    gross_weight: float | None = None


class ProductCreate(BaseModel):
    """Payload to create a new product."""

    product_code: str | None = Field(default=None, max_length=50)
    product_name_tally: str = Field(..., min_length=1, max_length=255)
    product_name_invoice: str | None = Field(default=None, max_length=255)
    product_name: str | None = Field(default=None, max_length=255)  # Optional alias (defaults to product_name_tally)
    barcode: str | None = Field(default=None, max_length=100)
    product_type: str = Field(default="Machine", max_length=50, description="Machine vs Spare Part")
    applicable_machine_ids: list[uuid.UUID] | None = None

    category_id: uuid.UUID
    sub_category_id: uuid.UUID | None = None
    brand_id: uuid.UUID | None = None
    uom_id: uuid.UUID
    secondary_uom_id: uuid.UUID | None = None
    # HSN Code * on the form -- FK into the Taxes master. GST % / Import
    # Duty % are NOT accepted here: they belong to the Tax record itself
    # and are always read off the joined Tax row (see ProductRead), so a
    # stale/edited value on one product can never drift from the master.
    hsn_id: uuid.UUID | None = None
    organization_id: uuid.UUID | None = None
    organization_ids: list[uuid.UUID] | None = None
    branch_ids: list[str] | None = None

    dimensions_rows: list[ProductDimensionRowIn] | None = None

    refund_vat_percent: float | None = Field(default=None, ge=0, le=100)
    license_certificate_required: str | None = None

    specification: str | None = None
    description: str | None = None
    images: list[str] | None = None

    packaging_quantity: float = Field(..., ge=0, description="Packaging Quantity (unit) is mandatory")
    packaging_net_weight: float | None = Field(default=None, ge=0)
    packaging_gross_weight: float | None = Field(default=None, ge=0)

    weight: float | None = Field(default=None, ge=0)
    length: float | None = Field(default=None, ge=0)
    width: float | None = Field(default=None, ge=0)
    height: float | None = Field(default=None, ge=0)
    length_cm: float | None = Field(default=None, ge=0)
    width_cm: float | None = Field(default=None, ge=0)
    height_cm: float | None = Field(default=None, ge=0)
    packaging_unit_cbm: float | None = Field(default=None, ge=0)
    color: str | None = Field(default=None, max_length=50)
    material: str | None = Field(default=None, max_length=100)

    conversion_factor: float | None = Field(default=None, gt=0)
    minimum_order_quantity: float | None = Field(default=None, ge=0)
    reorder_level: float | None = Field(default=None, ge=0)
    standard_cost: float | None = Field(default=None, ge=0)
    standard_price: float | None = Field(default=None, ge=0)
    minimum_price: float | None = Field(default=None, ge=0)
    is_purchasable: bool = True
    is_sellable: bool = True
    is_active_for_inventory: bool = True

    status: RecordStatus = RecordStatus.ACTIVE

    @model_validator(mode="after")
    def validate_packaging_and_cbm(self) -> ProductCreate:
        if self.packaging_gross_weight is None or self.packaging_gross_weight <= 0:
            raise ValueError("Packaging Gross Weight (kg) is required and must be greater than 0.")

        # Compute CBM using client rounding rule if dimensions are given and CBM is missing or 0
        l = self.length_cm or self.length
        w = self.width_cm or self.width
        h = self.height_cm or self.height
        if (self.packaging_unit_cbm is None or self.packaging_unit_cbm <= 0) and (l and w and h and l > 0 and w > 0 and h > 0):
            self.packaging_unit_cbm = compute_client_cbm(l, w, h)

        if self.packaging_unit_cbm is None or self.packaging_unit_cbm <= 0:
            raise ValueError("Packaging Unit CBM is required (enter Length, Width, Height to auto-calculate or enter Packaging Unit CBM directly).")

        return self


class ProductUpdate(BaseModel):
    """Payload to update an existing product. All fields optional (partial update)."""

    product_code: str | None = Field(default=None, min_length=1, max_length=50)
    product_name_tally: str | None = Field(default=None, min_length=1, max_length=255)
    product_name_invoice: str | None = Field(default=None, max_length=255)
    product_name: str | None = Field(default=None, max_length=255)
    barcode: str | None = Field(default=None, max_length=100)
    product_type: str | None = Field(default=None, max_length=50)
    applicable_machine_ids: list[uuid.UUID] | None = None

    category_id: uuid.UUID | None = None
    sub_category_id: uuid.UUID | None = None
    brand_id: uuid.UUID | None = None
    uom_id: uuid.UUID | None = None
    secondary_uom_id: uuid.UUID | None = None
    hsn_id: uuid.UUID | None = None
    organization_id: uuid.UUID | None = None
    organization_ids: list[uuid.UUID] | None = None
    branch_ids: list[str] | None = None

    dimensions_rows: list[ProductDimensionRowIn] | None = None

    refund_vat_percent: float | None = Field(default=None, ge=0, le=100)
    license_certificate_required: str | None = None

    specification: str | None = None
    description: str | None = None
    images: list[str] | None = None

    packaging_quantity: float | None = Field(default=None, ge=0)
    packaging_net_weight: float | None = Field(default=None, ge=0)
    packaging_gross_weight: float | None = Field(default=None, ge=0)
    weight: float | None = Field(default=None, ge=0)
    length: float | None = Field(default=None, ge=0)
    width: float | None = Field(default=None, ge=0)
    height: float | None = Field(default=None, ge=0)
    length_cm: float | None = Field(default=None, ge=0)
    width_cm: float | None = Field(default=None, ge=0)
    height_cm: float | None = Field(default=None, ge=0)
    packaging_unit_cbm: float | None = Field(default=None, ge=0)
    color: str | None = Field(default=None, max_length=50)
    material: str | None = Field(default=None, max_length=100)

    conversion_factor: float | None = Field(default=None, gt=0)
    minimum_order_quantity: float | None = Field(default=None, ge=0)
    reorder_level: float | None = Field(default=None, ge=0)
    standard_cost: float | None = Field(default=None, ge=0)
    standard_price: float | None = Field(default=None, ge=0)
    minimum_price: float | None = Field(default=None, ge=0)
    is_purchasable: bool | None = None
    is_sellable: bool | None = None
    is_active_for_inventory: bool | None = None

    status: RecordStatus | None = None


class ProductRead(BaseModel):
    """A product, as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    product_code: str | None = None
    product_name_tally: str | None = None
    product_name_invoice: str | None = None
    product_name: str
    barcode: str | None
    product_type: str = "Machine"
    applicable_machine_ids: list[uuid.UUID] | None = None

    category_id: uuid.UUID
    sub_category_id: uuid.UUID | None
    brand_id: uuid.UUID | None
    uom_id: uuid.UUID
    secondary_uom_id: uuid.UUID | None
    hsn_id: uuid.UUID | None = None
    organization_id: uuid.UUID | None = None
    organization_ids: list[uuid.UUID] | None = None
    branch_ids: list[str] | None = None

    dimensions_rows: list[ProductDimensionRowRead] = Field(default_factory=list, validation_alias="dimension_rows")

    @computed_field
    @property
    def hsn_number(self) -> str | None:
        return self.hsn.hsn_number if self.hsn else None

    @computed_field
    @property
    def gst_percent(self) -> float | None:
        return float(self.hsn.gst_percent) if self.hsn else None

    @computed_field
    @property
    def import_duty_percent(self) -> float | None:
        return float(self.hsn.import_duty_percent) if self.hsn else None

    # Not exposed directly (excluded below) -- backs the three computed
    # properties above by reading the eager-loaded Product.hsn relationship.
    hsn: "TaxRefRead | None" = Field(default=None, exclude=True)

    refund_vat_percent: float = 0.0
    license_certificate_required: str | None = None

    specification: str | None
    description: str | None
    images: list[str] | None = None

    @computed_field
    @property
    def image_url(self) -> str | None:
        if self.images and len(self.images) > 0:
            return self.images[0]
        return None

    packaging_quantity: float | None = None
    packaging_net_weight: float | None = None
    packaging_gross_weight: float | None = None
    weight: float | None
    length: float | None
    width: float | None
    height: float | None
    length_cm: float | None = None
    width_cm: float | None = None
    height_cm: float | None = None
    packaging_unit_cbm: float | None = None
    color: str | None
    material: str | None

    current_stock: float = 0.0
    conversion_factor: float | None
    minimum_order_quantity: float | None
    reorder_level: float | None
    standard_cost: float | None
    standard_price: float | None
    minimum_price: float | None = None
    is_purchasable: bool
    is_sellable: bool
    is_active_for_inventory: bool

    status: RecordStatus
    created_at: datetime
    updated_at: datetime


ProductRead.model_rebuild()


class BulkDeletePayload(BaseModel):
    """Payload to bulk-delete products."""

    product_ids: list[uuid.UUID] = Field(..., min_length=1)


class MachineSpareMappingIn(BaseModel):
    """Payload to link a spare part to a machine."""

    machine_id: uuid.UUID
    spare_part_id: uuid.UUID
    remarks: str | None = Field(default=None, max_length=255)


class MachineSpareUnmapIn(BaseModel):
    """Payload to unlink a spare part from a machine."""

    machine_id: uuid.UUID
    spare_part_id: uuid.UUID


class MachineSpareItemRead(BaseModel):
    """A spare part linked to a machine."""

    spare_part_id: uuid.UUID
    spare_part_name: str
    spare_part_code: str | None = None
    uom: str | None = None
    standard_price: float | None = None
    current_stock: float = 0.0
    remarks: str | None = None


class MachineWithSparesRead(BaseModel):
    """Universal view representation of a machine and its mapped spare parts."""

    machine_id: uuid.UUID
    machine_name: str
    machine_code: str | None = None
    current_stock: float = 0.0
    brand_name: str | None = None
    category_name: str | None = None
    spares: list[MachineSpareItemRead] = Field(default_factory=list)


class PackageDimensionReportRow(BaseModel):
    """One row in the package dimensions report."""

    dimension_id: uuid.UUID | None = None
    product_id: uuid.UUID
    product_name: str
    product_code: str | None = None
    product_type: str = "Machine"
    package_name: str | None = None
    title: str | None = None
    length: float | None = None
    width: float | None = None
    height: float | None = None
    cbm: float | None = None
    net_weight: float | None = None
    gross_weight: float | None = None


class ImportSummaryRead(BaseModel):
    """Result summary returned after a CSV/Excel import.

    ``duplicates`` holds every row that collided with an existing record
    (a subset of ``failed``), each with its full original row data and --
    when available -- the existing record it collided with, so the client
    can render a side-by-side comparison instead of just an error string.
    """

    total_rows: int
    created: int
    failed: int
    duplicate_count: int = 0
    errors: list[dict]
    duplicates: list[dict] = []
    in_file_duplicate_count: int = 0
    in_file_duplicates: list[dict] = []