"""
CRM Sales Quotation and Product Association Service.

Handles:
- Product Master lookup and search for CRM
- Lead-Product interest associations
- Decimal-safe sales quotation calculations (no silent defaults, half-up rounding)
- Concurrency-safe quotation numbering (SQ-YYYYMM-XXXX)
- Immutable revision snapshots and version history
- Server-side role-based scoping (Admin, Manager, Salesperson)
- Exactly-once CRM activity logging
"""

from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from sqlalchemy import desc, func, inspect as sa_inspect, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.service import CurrentUser
from app.core.constants import RecordStatus
from app.core.exceptions import (
    BadRequestException,
    ConflictException,
    ForbiddenException,
    NotFoundException,
)
from app.database.base import _utcnow
from app.core.logging import get_logger
from app.masters.products.models import Product


def _sanitize_crm_image_url(url: str | None) -> str | None:
    """Return None for empty or reserved non-resolvable synthetic domains (*.test, *.invalid, *.example)."""
    if not url or not isinstance(url, str):
        return None
    u = url.strip()
    if not u:
        return None
    if u.lower().startswith(("http://", "https://")):
        from urllib.parse import urlparse
        host = (urlparse(u).hostname or "").lower()
        if host.endswith((".test", ".invalid", ".example")) or host in {"test", "invalid", "example"}:
            return None
    return u


def _resolve_product_spec_pdf_link(product: Product | None) -> str | None:
    """Return the DB-stored Specification document link for a product when an uploaded document exists."""
    if product is None:
        return None
    doc_url = getattr(product, "specification_doc_url", None)
    if doc_url and str(doc_url).strip():
        return str(doc_url).strip()
    doc_id = getattr(product, "specification_doc_id", None)
    if doc_id:
        from app.common.storage import sanitize_filename
        doc_name = sanitize_filename(getattr(product, "specification_doc_name", None) or "specification.pdf")
        return f"/api/v1/masters/products/specification-documents/{doc_id}/{doc_name}"
    spec = getattr(product, "specification", None)
    if spec and isinstance(spec, str):
        s = spec.strip()
        if s.startswith(("http://", "https://", "/api/")):
            return s
    return None
from app.companies.models import Company, CompanyContact
from app.organizations.models import Organization
from app.users.models import User
from app.crm.lead_service import CrmLeadService, _is_system_activity
from app.crm.models import (
    CrmActivity,
    CrmLead,
    CrmLeadProduct,
    CrmQuotationItem,
    CrmQuotationVersion,
    CrmSalesQuotation,
)
from app.crm.schemas import (
    CrmLeadProductCreate,
    CrmLeadProductListResponse,
    CrmLeadProductRead,
    CrmProductLookupItem,
    CrmProductLookupResponse,
    CrmQuotationItemIn,
    CrmQuotationItemRead,
    CrmQuotationStatusUpdate,
    CrmQuotationVersionRead,
    CrmSalesQuotationCreate,
    CrmSalesQuotationListResponse,
    CrmSalesQuotationRead,
    CrmSalesQuotationUpdate,
    CrmQuotationShareActivityCreate,
)

logger = get_logger(__name__)

TWOPLACES = Decimal("0.01")
THREEPLACES = Decimal("0.001")


def _round2(val: Decimal) -> Decimal:
    return val.quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def _round3(val: Decimal) -> Decimal:
    return val.quantize(THREEPLACES, rounding=ROUND_HALF_UP)


def is_internal_lead_label(val: str | None, lead_code: str | None = None) -> bool:
    """Detect if a string is an internal lead placeholder or administrative label."""
    if not val:
        return True
    s = val.strip().lower()
    if s in {"", "-", "—", "n/a", "na", "none", "null", "undefined", "unassigned", "system", "customer"}:
        return True
    internal_keywords = [
        "open lead only",
        "open lead",
        "unmatched legacy",
        "unmatched",
        "legacy lead",
        "new lead",
        "test lead",
        "dummy",
        "sample lead",
        "nonexistent entity",
        "nonexistent",
        "unknown entity",
        "unknown",
        "no company",
    ]
    if any(k in s for k in internal_keywords):
        return True
    if s.startswith("crm-") or s.startswith("ld-") or s.startswith("lead-"):
        return True
    if lead_code and (lead_code.lower() == s or lead_code.lower() in s):
        return True
    return False


def format_phone_display(phone: str | None) -> str | None:
    """Format phone numbers cleanly without raw artifacts or invalid placeholders."""
    if not phone:
        return None
    cleaned = phone.strip()
    digits = "".join(c for c in cleaned if c.isdigit())
    if len(digits) < 7:
        return None
    if set(digits) == {"0"}:
        return None
    # 10-digit standard Indian mobile/landline
    if len(digits) == 10:
        return f"+91 {digits[:5]} {digits[5:]}"
    # 12-digit standard with country code 91
    if len(digits) == 12 and digits.startswith("91"):
        return f"+91 {digits[2:7]} {digits[7:]}"
    # Clean leading plus
    if cleaned.startswith("+"):
        return cleaned
    return cleaned


def format_address(company: Company | None) -> str | None:
    """Format company billing address components into a coherent string."""
    if not company:
        return None
    parts: list[str] = []
    if company.address and company.address.strip():
        parts.append(company.address.strip())
    if company.town and company.town.strip():
        parts.append(company.town.strip())
    if company.district and company.district.strip():
        parts.append(company.district.strip())
    if company.pincode and company.pincode.strip():
        parts.append(company.pincode.strip())
    if not parts:
        return None
    return ", ".join(parts)


def find_associated_company_contact(
    contacts: list[CompanyContact],
    lead: CrmLead,
) -> CompanyContact | None:
    """Find the contact associated with the lead among linked company contacts."""
    if not contacts:
        return None

    lead_email = (lead.email or "").strip().lower()
    lead_phone_digits = "".join(c for c in (lead.normalized_phone or lead.original_phone or "") if c.isdigit())
    lead_name = (lead.name or "").strip().lower()
    lead_is_placeholder = is_internal_lead_label(lead.name, getattr(lead, "lead_code", None))

    # 1. Match by email
    if lead_email and "@" in lead_email:
        for c in contacts:
            if c.email and c.email.strip().lower() == lead_email:
                return c

    # 2. Match by phone (last 10 digits)
    if len(lead_phone_digits) >= 10:
        target_tail = lead_phone_digits[-10:]
        for c in contacts:
            for num_field in (c.calling_number, c.whatsapp_number):
                if num_field:
                    num_digits = "".join(ch for ch in num_field if ch.isdigit())
                    if len(num_digits) >= 10 and num_digits.endswith(target_tail):
                        return c

    # 3. Match by person name if lead name is not an internal placeholder
    if not lead_is_placeholder and lead_name:
        for c in contacts:
            if c.person_name and c.person_name.strip().lower() == lead_name:
                return c

    # 4. If exactly one contact exists on the company
    if len(contacts) == 1:
        return contacts[0]

    # Rule 3: If multiple contacts exist and none matched, do not select an arbitrary contact
    return None


def resolve_customer_details(
    lead: CrmLead | None,
    company: Company | None = None,
    snapshot_data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Authoritatively resolve customer and company details for CRM Quotation.
    Never fabricates customer details; omits unavailable fields.
    """
    snap = snapshot_data or {}
    lead_code = getattr(lead, "lead_code", None) if lead else None

    # 1. Authoritative Company Name
    comp_name: str | None = None
    if snap.get("company_name_snapshot") and not is_internal_lead_label(snap.get("company_name_snapshot")):
        comp_name = str(snap["company_name_snapshot"]).strip()
    elif company and company.company_name and not is_internal_lead_label(company.company_name):
        comp_name = company.company_name.strip()
    elif lead and lead.company_name and not is_internal_lead_label(lead.company_name, lead_code):
        comp_name = lead.company_name.strip()

    # 2. Authoritative GSTIN
    cust_gstin: str | None = None
    if snap.get("customer_gstin_snapshot"):
        cust_gstin = str(snap["customer_gstin_snapshot"]).strip()
    elif company and company.tax_id_number:
        cust_gstin = company.tax_id_number.strip()

    # 3. Billing Address
    billing_addr: str | None = None
    if snap.get("billing_address_snapshot"):
        billing_addr = str(snap["billing_address_snapshot"]).strip()
    elif company:
        billing_addr = format_address(company)

    # 4. Associated contact resolution
    assoc_contact: CompanyContact | None = None
    if company and hasattr(company, "contacts") and company.contacts and lead:
        assoc_contact = find_associated_company_contact(company.contacts, lead)

    # 5. Customer Contact Name
    cust_name: str | None = None
    if snap.get("customer_name_snapshot") and not is_internal_lead_label(snap.get("customer_name_snapshot"), lead_code):
        cust_name = str(snap["customer_name_snapshot"]).strip()
    elif assoc_contact and assoc_contact.person_name and not is_internal_lead_label(assoc_contact.person_name):
        cust_name = assoc_contact.person_name.strip()
    elif lead and lead.name and not is_internal_lead_label(lead.name, lead_code):
        if not (comp_name and lead.name.strip().lower() == comp_name.lower()):
            cust_name = lead.name.strip()
    elif company and getattr(company, "contact_full_name", None) and not is_internal_lead_label(company.contact_full_name):
        cust_name = company.contact_full_name.strip()

    if not cust_name and snap.get("customer_name_snapshot") and not is_internal_lead_label(snap.get("customer_name_snapshot"), lead_code):
        cust_name = str(snap["customer_name_snapshot"]).strip()
    if not cust_name and lead and lead.name and not is_internal_lead_label(lead.name, lead_code):
        cust_name = lead.name.strip()

    # 6. Contact Designation
    designation: str | None = None
    if snap.get("customer_designation_snapshot"):
        designation = str(snap["customer_designation_snapshot"]).strip()
    elif assoc_contact and assoc_contact.designation:
        designation = assoc_contact.designation.strip()
    elif company and getattr(company, "contact_designation", None) and company.contact_designation:
        designation = company.contact_designation.strip()

    # 7. Contact Phone
    phone: str | None = None
    if snap.get("customer_phone_snapshot"):
        phone = format_phone_display(str(snap["customer_phone_snapshot"]))
    elif lead and (lead.original_phone or lead.normalized_phone):
        phone = format_phone_display(lead.original_phone or lead.normalized_phone)
    elif assoc_contact:
        phone = format_phone_display(assoc_contact.calling_number or assoc_contact.whatsapp_number)
    elif company and getattr(company, "contact_calling_number", None):
        phone = format_phone_display(company.contact_calling_number or company.contact_whatsapp_number)

    # 8. Contact Email
    email: str | None = None
    if snap.get("customer_email_snapshot") and "@" in str(snap.get("customer_email_snapshot", "")):
        email = str(snap["customer_email_snapshot"]).strip()
    elif lead and lead.email and "@" in lead.email:
        email = lead.email.strip()
    elif assoc_contact and assoc_contact.email:
        email = assoc_contact.email.strip()

    return {
        "customer_name": cust_name,
        "customer_designation": designation,
        "customer_phone": phone,
        "customer_email": email,
        "company_name": comp_name,
        "billing_address": billing_addr,
        "customer_gstin": cust_gstin,
    }


class CrmQuotationService:
    """Service for CRM lead product associations and sales quotations."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.lead_service = CrmLeadService(session)

    # -------------------------------------------------------------------------
    # 1. Product Master Search & Lookup
    # -------------------------------------------------------------------------

    async def search_products(
        self,
        *,
        query: str | None = None,
        limit: int = 50,
        actor: CurrentUser,
    ) -> CrmProductLookupResponse:
        """
        Search Product Master items available for CRM quoting and association.
        Enforces that only non-deleted, active, and sellable products are returned.
        """
        stmt = (
            select(Product)
            .options(selectinload(Product.hsn))
            .where(
                Product.deleted_at.is_(None),
                Product.status == RecordStatus.ACTIVE,
                Product.is_sellable.is_(True),
            )
        )

        if query and query.strip():
            term = f"%{query.strip()}%"
            stmt = stmt.where(
                or_(
                    Product.product_name.ilike(term),
                    Product.product_code.ilike(term),
                    Product.barcode.ilike(term),
                )
            )

        stmt = stmt.order_by(Product.product_name.asc()).limit(limit)
        products = (await self.session.execute(stmt)).scalars().all()

        items: list[CrmProductLookupItem] = []
        for p in products:
            img_list: list[str] = []
            if isinstance(p.images, list):
                img_list = [str(url) for url in p.images if url]

            gst = float(p.hsn.gst_percent) if (p.hsn and p.hsn.gst_percent is not None) else None
            hsn_num = p.hsn.hsn_number if p.hsn else None

            items.append(
                CrmProductLookupItem(
                    id=p.id,
                    product_code=p.product_code,
                    product_name=p.product_name,
                    specification=_resolve_product_spec_pdf_link(p) or p.specification,
                    specification_doc_name=getattr(p, "specification_doc_name", None),
                    specification_doc_url=getattr(p, "specification_doc_url", None),
                    description=p.description,
                    uom="Nos",
                    standard_price=float(p.standard_price) if p.standard_price is not None else None,
                    minimum_price=float(p.minimum_price) if p.minimum_price is not None else None,
                    gst_percent=gst,
                    hsn_number=hsn_num,
                    images=img_list,
                    status=p.status.value if hasattr(p.status, "value") else str(p.status),
                    is_sellable=p.is_sellable,
                )
            )

        return CrmProductLookupResponse(items=items, total=len(items))

    # -------------------------------------------------------------------------
    # 2. Lead-Product Associations
    # -------------------------------------------------------------------------

    async def list_lead_products(
        self,
        lead_id: uuid.UUID,
        *,
        actor: CurrentUser,
    ) -> CrmLeadProductListResponse:
        """List products associated with a CRM lead, enforcing scope."""
        lead = await self.session.get(CrmLead, lead_id)
        if not lead or lead.deleted_at is not None:
            raise NotFoundException(f"Lead with id {lead_id} not found.")

        await self.lead_service._check_lead_scope(lead, actor, action="view")

        stmt = (
            select(CrmLeadProduct)
            .options(selectinload(CrmLeadProduct.product))
            .where(CrmLeadProduct.lead_id == lead_id)
            .order_by(desc(CrmLeadProduct.created_at))
        )
        associations = (await self.session.execute(stmt)).scalars().all()

        items: list[CrmLeadProductRead] = []
        for assoc in associations:
            p = assoc.product
            selected_img = None
            if p and isinstance(p.images, list) and len(p.images) > 0:
                selected_img = p.images[0]

            items.append(
                CrmLeadProductRead(
                    id=assoc.id,
                    lead_id=assoc.lead_id,
                    product_id=assoc.product_id,
                    product_name=p.product_name if p else "Unknown Product",
                    product_code=p.product_code if p else None,
                    specification=p.specification if p else None,
                    uom="Nos",
                    selected_image_url=selected_img,
                    notes=assoc.notes,
                    created_at=assoc.created_at,
                    created_by=assoc.created_by,
                )
            )

        return CrmLeadProductListResponse(items=items, total=len(items))

    async def associate_product(
        self,
        lead_id: uuid.UUID,
        payload: CrmLeadProductCreate,
        *,
        actor: CurrentUser,
    ) -> CrmLeadProductRead:
        """Associate an existing Product Master product with a lead."""
        lead = await self.session.get(CrmLead, lead_id)
        if not lead or lead.deleted_at is not None:
            raise NotFoundException(f"Lead with id {lead_id} not found.")

        await self.lead_service._check_lead_scope(lead, actor, action="edit")

        product = await self.session.get(Product, payload.product_id)
        if not product or product.deleted_at is not None or product.status != RecordStatus.ACTIVE:
            raise BadRequestException("Selected product is invalid, deleted, or inactive.")

        # Check existing association
        dup_stmt = select(CrmLeadProduct).where(
            CrmLeadProduct.lead_id == lead_id,
            CrmLeadProduct.product_id == payload.product_id,
        )
        existing = (await self.session.execute(dup_stmt)).scalar_one_or_none()
        if existing:
            raise BadRequestException("Product is already associated with this lead.")

        new_assoc = CrmLeadProduct(
            lead_id=lead_id,
            product_id=payload.product_id,
            notes=payload.notes,
            created_by=actor.id,
        )
        self.session.add(new_assoc)

        # Exactly-once activity logging
        activity = CrmActivity(
            lead_id=lead_id,
            activity_type="product_associated",
            subject=f"Product '{product.product_name}' associated with lead",
            description=payload.notes,
            performed_by=actor.id,
            activity_at=_utcnow(),
            created_at=_utcnow(),
        )
        self.session.add(activity)

        lead.updated_at = _utcnow()
        await self.session.commit()
        await self.session.refresh(new_assoc)

        selected_img = product.images[0] if (product.images and len(product.images) > 0) else None
        return CrmLeadProductRead(
            id=new_assoc.id,
            lead_id=new_assoc.lead_id,
            product_id=new_assoc.product_id,
            product_name=product.product_name,
            product_code=product.product_code,
            specification=product.specification,
            uom="Nos",
            selected_image_url=selected_img,
            notes=new_assoc.notes,
            created_at=new_assoc.created_at,
            created_by=new_assoc.created_by,
        )

    async def remove_lead_product(
        self,
        lead_id: uuid.UUID,
        product_id: uuid.UUID,
        *,
        actor: CurrentUser,
    ) -> dict[str, Any]:
        """Remove a product association from a lead."""
        lead = await self.session.get(CrmLead, lead_id)
        if not lead or lead.deleted_at is not None:
            raise NotFoundException(f"Lead with id {lead_id} not found.")

        await self.lead_service._check_lead_scope(lead, actor, action="edit")

        stmt = select(CrmLeadProduct).where(
            CrmLeadProduct.lead_id == lead_id,
            or_(CrmLeadProduct.id == product_id, CrmLeadProduct.product_id == product_id),
        )
        assoc = (await self.session.execute(stmt)).scalar_one_or_none()
        if not assoc:
            raise NotFoundException("Product association not found on this lead.")

        product = await self.session.get(Product, assoc.product_id)
        prod_name = product.product_name if product else "Product"

        await self.session.delete(assoc)

        activity = CrmActivity(
            lead_id=lead_id,
            activity_type="product_disassociated",
            subject=f"Product '{prod_name}' removed from lead associations",
            performed_by=actor.id,
            activity_at=_utcnow(),
            created_at=_utcnow(),
        )
        self.session.add(activity)

        lead.updated_at = _utcnow()
        await self.session.commit()
        return {"removed": True, "lead_id": str(lead_id), "product_id": str(assoc.product_id)}

    # -------------------------------------------------------------------------
    # 3. Commercial Calculations & Numbering Helpers
    # -------------------------------------------------------------------------

    async def _generate_quotation_number(self) -> str:
        """
        Generate next sequential unique quotation number in SQ-YYYYMM-XXXX format.
        """
        prefix = f"SQ-{datetime.now(timezone.utc).strftime('%Y%m')}"
        stmt = (
            select(CrmSalesQuotation.quotation_number)
            .where(CrmSalesQuotation.quotation_number.like(f"{prefix}-%"))
            .order_by(desc(CrmSalesQuotation.quotation_number))
            .limit(1)
        )
        last_num = (await self.session.execute(stmt)).scalar_one_or_none()

        next_seq = 1
        if last_num:
            parts = last_num.split("-")
            if len(parts) == 3 and parts[2].isdigit():
                next_seq = int(parts[2]) + 1

        return f"{prefix}-{next_seq:04d}"

    def _calculate_commercials(
        self,
        items_in: list[CrmQuotationItemIn],
        products_map: dict[uuid.UUID, Product],
    ) -> tuple[list[dict[str, Any]], Decimal, Decimal, Decimal, Decimal]:
        """
        Calculate decimal-safe line totals and commercial quotation totals.
        Uses Decimal with ROUND_HALF_UP rounding.

        Returns:
            (line_data_list, subtotal, discount_total, tax_total, total_amount)
        """
        calculated_lines: list[dict[str, Any]] = []
        subtotal = Decimal("0.00")
        discount_total = Decimal("0.00")
        tax_total = Decimal("0.00")
        total_amount = Decimal("0.00")

        for pos, item in enumerate(items_in, start=1):
            product = products_map.get(item.product_id)
            if not product:
                raise BadRequestException(f"Product {item.product_id} not found in catalog.")

            qty = _round3(item.quantity)
            if qty <= Decimal("0"):
                raise BadRequestException(f"Item quantity must be greater than zero for '{product.product_name}'.")

            price = _round2(item.unit_price)
            if price < Decimal("0"):
                raise BadRequestException(f"Unit price cannot be negative for '{product.product_name}'.")

            disc = _round2(item.unit_discount)
            if disc < Decimal("0") or disc > price:
                raise BadRequestException(
                    f"Unit discount ({disc}) must be between 0.00 and unit price ({price}) for '{product.product_name}'."
                )

            tax_pct = _round2(item.tax_rate)
            if tax_pct < Decimal("0") or tax_pct > Decimal("100.00"):
                raise BadRequestException(
                    f"Tax rate ({tax_pct}%) must be between 0% and 100% for '{product.product_name}'."
                )

            # Line taxable = (unit_price - unit_discount) * quantity
            line_taxable = _round2((price - disc) * qty)
            # Line tax = taxable * (tax_rate / 100)
            line_tax = _round2(line_taxable * (tax_pct / Decimal("100.00")))
            # Line total = taxable + tax
            line_total = _round2(line_taxable + line_tax)

            line_discount = _round2(disc * qty)

            subtotal += line_taxable
            discount_total += line_discount
            tax_total += line_tax
            total_amount += line_total

            # Product snapshot
            img_to_include = None
            if item.include_images:
                if item.selected_image_url:
                    img_to_include = item.selected_image_url
                elif product.images and len(product.images) > 0:
                    img_to_include = product.images[0]

            prod_pdf_link = _resolve_product_spec_pdf_link(product)
            effective_include_specs = True if prod_pdf_link else item.include_specifications
            default_spec = prod_pdf_link or product.specification
            effective_spec = (
                (item.specification if (item.specification and item.specification.strip()) else default_spec)
                if effective_include_specs
                else None
            )
            calculated_lines.append(
                {
                    "product_id": product.id,
                    "position": pos,
                    "product_name": product.product_name,
                    "product_code": product.product_code,
                    "description": item.description if item.description is not None else product.description,
                    "specification": effective_spec,
                    "uom": item.uom or "Nos",
                    "include_images": item.include_images,
                    "selected_image_url": img_to_include,
                    "include_specifications": effective_include_specs,
                    "demo_link": item.demo_link,
                    "quantity": qty,
                    "unit_price": price,
                    "unit_discount": disc,
                    "tax_rate": tax_pct,
                    "taxable_amount": line_taxable,
                    "tax_amount": line_tax,
                    "total_amount": line_total,
                }
            )

        return calculated_lines, subtotal, discount_total, tax_total, total_amount

    def _serialize_quotation(self, q: CrmSalesQuotation) -> dict[str, Any]:
        """Create an immutable historical snapshot dictionary of a quotation revision."""
        items_data = []
        is_draft_quote = (getattr(q, "status", "") or "").lower() == "draft"
        for it in q.items:
            loaded_prod = it.product if "product" not in sa_inspect(it).unloaded else None
            prod_pdf = _resolve_product_spec_pdf_link(loaded_prod)
            spec_val = it.specification
            inc_specs = it.include_specifications
            if prod_pdf and (not spec_val or is_draft_quote):
                spec_val = prod_pdf
                inc_specs = True
            spec_doc_name = getattr(loaded_prod, "specification_doc_name", None) if loaded_prod else None
            items_data.append(
                {
                    "position": it.position,
                    "product_id": str(it.product_id),
                    "product_name": it.product_name,
                    "product_code": it.product_code,
                    "description": it.description,
                    "specification": spec_val,
                    "specification_doc_name": spec_doc_name,
                    "uom": it.uom,
                    "include_images": it.include_images,
                    "selected_image_url": it.selected_image_url,
                    "include_specifications": inc_specs,
                    "demo_link": it.demo_link,
                    "quantity": float(it.quantity),
                    "unit_price": float(it.unit_price),
                    "unit_discount": float(it.unit_discount),
                    "tax_rate": float(it.tax_rate),
                    "taxable_amount": float(it.taxable_amount),
                    "tax_amount": float(it.tax_amount),
                    "total_amount": float(it.total_amount),
                }
            )

        # Authoritatively resolve customer snapshot details from linked lead/company
        lead_obj = getattr(q, "lead", None)
        company_obj = getattr(q, "company", None) or (getattr(lead_obj, "company", None) if lead_obj else None)
        cust_info = resolve_customer_details(
            lead=lead_obj,
            company=company_obj,
            snapshot_data={
                "customer_name_snapshot": q.customer_name_snapshot,
                "customer_phone_snapshot": q.customer_phone_snapshot,
                "customer_email_snapshot": q.customer_email_snapshot,
                "company_name_snapshot": q.company_name_snapshot,
            },
        )

        header_dict = {
            "quotation_number": q.quotation_number,
            "version": q.version,
            "status": q.status,
            "quotation_date": q.quotation_date.isoformat() if q.quotation_date else None,
            "valid_until": q.valid_until.isoformat() if q.valid_until else None,
            "currency": q.currency,
            "customer_name_snapshot": cust_info["customer_name"] or q.customer_name_snapshot or "—",
            "customer_designation_snapshot": cust_info["customer_designation"],
            "customer_phone_snapshot": cust_info["customer_phone"] or q.customer_phone_snapshot,
            "customer_email_snapshot": cust_info["customer_email"] or q.customer_email_snapshot,
            "company_name_snapshot": cust_info["company_name"] or q.company_name_snapshot,
            "billing_address_snapshot": cust_info["billing_address"],
            "customer_gstin_snapshot": cust_info["customer_gstin"],
            "subtotal": float(q.subtotal),
            "discount_total": float(q.discount_total),
            "tax_total": float(q.tax_total),
            "total_amount": float(q.total_amount),
            "payment_terms": q.payment_terms,
            "delivery_terms": q.delivery_terms,
            "notes": q.notes,
            "terms_and_conditions": q.terms_and_conditions,
            "created_by_name": q.created_by_name,
        }
        res = dict(header_dict)
        res["header"] = header_dict
        res["items"] = items_data
        return res

    # -------------------------------------------------------------------------
    # 4. Quotation CRUD & Revisions
    # -------------------------------------------------------------------------

    async def create_quotation(
        self,
        lead_id: uuid.UUID,
        payload: CrmSalesQuotationCreate,
        *,
        actor: CurrentUser,
    ) -> CrmSalesQuotationRead:
        """Create a new sales quotation draft for a lead."""
        lead = await self.session.get(CrmLead, lead_id)
        if not lead or lead.deleted_at is not None:
            raise NotFoundException(f"Lead with id {lead_id} not found.")

        await self.lead_service._check_lead_scope(lead, actor, action="edit")

        if not payload.items or len(payload.items) == 0:
            raise BadRequestException("Quotation must contain at least one line item.")

        # Batch load products and validate
        product_ids = [it.product_id for it in payload.items]
        p_stmt = select(Product).where(
            Product.id.in_(product_ids),
            Product.deleted_at.is_(None),
            Product.status == RecordStatus.ACTIVE,
        )
        products = (await self.session.execute(p_stmt)).scalars().all()
        products_map = {p.id: p for p in products}

        if len(products_map) != len(set(product_ids)):
            missing = set(product_ids) - set(products_map.keys())
            raise BadRequestException(f"One or more products are invalid or inactive: {missing}")

        line_data_list, subtotal, discount_total, tax_total, total_amount = self._calculate_commercials(
            payload.items, products_map
        )

        quotation_number = await self._generate_quotation_number()
        actor_name = getattr(actor, "display_name", None) or getattr(actor, "username", "CRM User")

        company_obj = None
        if lead.company_id:
            c_stmt = (
                select(Company)
                .options(selectinload(Company.contacts))
                .where(Company.id == lead.company_id)
            )
            company_obj = (await self.session.execute(c_stmt)).scalar_one_or_none()
        elif lead.company_name and not is_internal_lead_label(lead.company_name):
            c_stmt = (
                select(Company)
                .options(selectinload(Company.contacts))
                .where(
                    func.lower(Company.company_name) == lead.company_name.strip().lower(),
                    Company.deleted_at.is_(None),
                    Company.is_active.is_(True),
                )
            )
            company_obj = (await self.session.execute(c_stmt)).scalars().first()
            if company_obj and not lead.company_id:
                lead.company_id = company_obj.id

        cust_info = resolve_customer_details(lead, company_obj)
        assigned_company_id = company_obj.id if company_obj else lead.company_id

        quotation = CrmSalesQuotation(
            quotation_number=quotation_number,
            lead_id=lead_id,
            company_id=assigned_company_id,
            version=1,
            status="draft",
            quotation_date=_utcnow(),
            valid_until=payload.valid_until,
            currency=payload.currency or "INR",
            customer_name_snapshot=cust_info["customer_name"] or "—",
            customer_phone_snapshot=cust_info["customer_phone"],
            customer_email_snapshot=cust_info["customer_email"],
            company_name_snapshot=cust_info["company_name"],
            subtotal=subtotal,
            discount_total=discount_total,
            tax_total=tax_total,
            total_amount=total_amount,
            payment_terms=payload.payment_terms,
            delivery_terms=payload.delivery_terms,
            notes=payload.notes,
            terms_and_conditions=payload.terms_and_conditions,
            created_by=actor.id,
            created_by_name=actor_name,
            updated_by=actor.id,
        )
        self.session.add(quotation)
        await self.session.flush()

        for line_data in line_data_list:
            item = CrmQuotationItem(
                quotation_id=quotation.id,
                **line_data,
            )
            self.session.add(item)

        # Log exactly-once CRM activity
        activity = CrmActivity(
            lead_id=lead_id,
            activity_type="quotation_created",
            subject=f"Sales Quotation {quotation_number} (v1) draft created — Total: {total_amount:,.2f} INR",
            description=f"Items: {len(line_data_list)}, Taxable: {subtotal:,.2f}, Tax: {tax_total:,.2f}",
            performed_by=actor.id,
            activity_at=_utcnow(),
            created_at=_utcnow(),
        )
        self.session.add(activity)

        lead.updated_at = _utcnow()
        await self.session.commit()

        return await self.get_quotation(quotation.id, actor=actor)

    async def list_lead_quotations(
        self,
        lead_id: uuid.UUID,
        *,
        actor: CurrentUser,
    ) -> CrmSalesQuotationListResponse:
        """List all sales quotations for a lead, ordered by newest first."""
        lead = await self.session.get(CrmLead, lead_id)
        if not lead or lead.deleted_at is not None:
            raise NotFoundException(f"Lead with id {lead_id} not found.")

        await self.lead_service._check_lead_scope(lead, actor, action="view")

        stmt = (
            select(CrmSalesQuotation)
            .options(
                selectinload(CrmSalesQuotation.lead).selectinload(CrmLead.company).selectinload(Company.contacts),
                selectinload(CrmSalesQuotation.company).selectinload(Company.contacts),
                selectinload(CrmSalesQuotation.items).selectinload(CrmQuotationItem.product),
                selectinload(CrmSalesQuotation.revisions),
            )
            .where(
                CrmSalesQuotation.lead_id == lead_id,
                CrmSalesQuotation.deleted_at.is_(None),
            )
            .order_by(desc(CrmSalesQuotation.created_at))
        )
        quotations = (await self.session.execute(stmt)).scalars().all()

        items = [self._build_read_model(q) for q in quotations]
        return CrmSalesQuotationListResponse(items=items, total=len(items))

    async def get_quotation(
        self,
        quotation_id: uuid.UUID,
        *,
        actor: CurrentUser,
    ) -> CrmSalesQuotationRead:
        """Get single sales quotation by ID with lines and revisions, verifying RBAC scope."""
        stmt = (
            select(CrmSalesQuotation)
            .options(
                selectinload(CrmSalesQuotation.lead).selectinload(CrmLead.company).selectinload(Company.contacts),
                selectinload(CrmSalesQuotation.company).selectinload(Company.contacts),
                selectinload(CrmSalesQuotation.items).selectinload(CrmQuotationItem.product),
                selectinload(CrmSalesQuotation.revisions),
            )
            .where(
                CrmSalesQuotation.id == quotation_id,
                CrmSalesQuotation.deleted_at.is_(None),
            )
        )
        q = (await self.session.execute(stmt)).scalar_one_or_none()
        if not q:
            raise NotFoundException(f"Quotation with id {quotation_id} not found.")

        # Strict authorization check for the associated lead
        await self.lead_service._check_lead_scope(q.lead, actor, action="view")

        return self._build_read_model(q)

    async def update_quotation(
        self,
        quotation_id: uuid.UUID,
        payload: CrmSalesQuotationUpdate,
        *,
        actor: CurrentUser,
    ) -> CrmSalesQuotationRead:
        """
        Update an existing quotation.
        If create_revision is True or quotation is not in 'draft' status:
        - Archives current revision into crm_quotation_versions
        - Increments quotation.version
        - Resets status to 'draft'
        """
        stmt = (
            select(CrmSalesQuotation)
            .options(
                selectinload(CrmSalesQuotation.lead).selectinload(CrmLead.company).selectinload(Company.contacts),
                selectinload(CrmSalesQuotation.company).selectinload(Company.contacts),
                selectinload(CrmSalesQuotation.items).selectinload(CrmQuotationItem.product),
                selectinload(CrmSalesQuotation.revisions),
            )
            .where(
                CrmSalesQuotation.id == quotation_id,
                CrmSalesQuotation.deleted_at.is_(None),
            )
        )
        q = (await self.session.execute(stmt)).scalar_one_or_none()
        if not q:
            raise NotFoundException(f"Quotation with id {quotation_id} not found.")

        await self.lead_service._check_lead_scope(q.lead, actor, action="edit")

        is_revision_needed = payload.create_revision or q.status != "draft"

        if is_revision_needed:
            # 1. Archive current revision snapshot
            snapshot = self._serialize_quotation(q)
            version_archive = CrmQuotationVersion(
                quotation_id=q.id,
                version=q.version,
                snapshot_data=snapshot,
                revision_notes=payload.revision_notes or f"Revision {q.version} archived before updating",
                created_by=actor.id,
                created_by_name=getattr(actor, "display_name", None) or getattr(actor, "username", "CRM User"),
            )
            self.session.add(version_archive)

            # 2. Increment version and reset status
            q.version += 1
            q.status = "draft"

        # Update terms/notes if provided
        if payload.valid_until is not None:
            q.valid_until = payload.valid_until
        if payload.currency is not None:
            q.currency = payload.currency
        if payload.payment_terms is not None:
            q.payment_terms = payload.payment_terms
        if payload.delivery_terms is not None:
            q.delivery_terms = payload.delivery_terms
        if payload.notes is not None:
            q.notes = payload.notes
        if payload.terms_and_conditions is not None:
            q.terms_and_conditions = payload.terms_and_conditions

        # Replace items if provided
        if payload.items is not None:
            if len(payload.items) == 0:
                raise BadRequestException("Quotation must contain at least one line item.")

            product_ids = [it.product_id for it in payload.items]
            p_stmt = select(Product).where(
                Product.id.in_(product_ids),
                Product.deleted_at.is_(None),
                Product.status == RecordStatus.ACTIVE,
            )
            products = (await self.session.execute(p_stmt)).scalars().all()
            products_map = {p.id: p for p in products}

            if len(products_map) != len(set(product_ids)):
                missing = set(product_ids) - set(products_map.keys())
                raise BadRequestException(f"One or more products are invalid or inactive: {missing}")

            line_data_list, subtotal, discount_total, tax_total, total_amount = self._calculate_commercials(
                payload.items, products_map
            )

            # Remove old items
            for old_item in q.items:
                await self.session.delete(old_item)
            await self.session.flush()

            # Insert new items
            for line_data in line_data_list:
                item = CrmQuotationItem(
                    quotation_id=q.id,
                    **line_data,
                )
                self.session.add(item)

            q.subtotal = subtotal
            q.discount_total = discount_total
            q.tax_total = tax_total
            q.total_amount = total_amount

        q.updated_by = actor.id
        q.updated_at = _utcnow()

        # Log activity
        action_desc = f"Revision v{q.version} created" if is_revision_needed else f"Draft (v{q.version}) updated"
        activity = CrmActivity(
            lead_id=q.lead_id,
            activity_type="quotation_updated",
            subject=f"Sales Quotation {q.quotation_number}: {action_desc} — Total: {q.total_amount:,.2f} INR",
            description=payload.revision_notes or f"Updated quotation {q.quotation_number}",
            performed_by=actor.id,
            activity_at=_utcnow(),
            created_at=_utcnow(),
        )
        self.session.add(activity)

        q.lead.updated_at = _utcnow()
        await self.session.commit()

        return await self.get_quotation(q.id, actor=actor)

    async def update_quotation_status(
        self,
        quotation_id: uuid.UUID,
        payload: CrmQuotationStatusUpdate,
        *,
        actor: CurrentUser,
    ) -> CrmSalesQuotationRead:
        """Update quotation lifecycle status (e.g. draft -> sent, accepted, rejected, cancelled)."""
        stmt = (
            select(CrmSalesQuotation)
            .options(selectinload(CrmSalesQuotation.lead))
            .where(
                CrmSalesQuotation.id == quotation_id,
                CrmSalesQuotation.deleted_at.is_(None),
            )
        )
        q = (await self.session.execute(stmt)).scalar_one_or_none()
        if not q:
            raise NotFoundException(f"Quotation with id {quotation_id} not found.")

        await self.lead_service._check_lead_scope(q.lead, actor, action="edit")

        old_status = q.status
        q.status = payload.status
        q.updated_by = actor.id
        q.updated_at = _utcnow()

        activity = CrmActivity(
            lead_id=q.lead_id,
            activity_type="quotation_status_change",
            subject=f"Sales Quotation {q.quotation_number} status changed from '{old_status}' to '{payload.status}'",
            description=payload.notes,
            performed_by=actor.id,
            activity_at=_utcnow(),
            created_at=_utcnow(),
        )
        self.session.add(activity)

        q.lead.updated_at = _utcnow()
        await self.session.commit()

        return await self.get_quotation(q.id, actor=actor)

    def _build_read_model(self, q: CrmSalesQuotation) -> CrmSalesQuotationRead:
        """Map ORM CrmSalesQuotation to CrmSalesQuotationRead."""
        is_draft_quote = (getattr(q, "status", "") or "").lower() == "draft"
        items: list[CrmQuotationItemRead] = []
        for it in (q.items or []):
            loaded_prod = it.product if "product" not in sa_inspect(it).unloaded else None
            prod_pdf = _resolve_product_spec_pdf_link(loaded_prod)
            spec_val = it.specification
            inc_specs = it.include_specifications
            if prod_pdf and (not spec_val or is_draft_quote):
                spec_val = prod_pdf
                inc_specs = True
            items.append(
                CrmQuotationItemRead(
                    id=it.id,
                    quotation_id=it.quotation_id,
                    product_id=it.product_id,
                    position=it.position,
                    product_name=it.product_name,
                    product_code=it.product_code,
                    description=it.description,
                    specification=spec_val,
                    specification_doc_name=getattr(loaded_prod, "specification_doc_name", None) if loaded_prod else None,
                    specification_doc_url=getattr(loaded_prod, "specification_doc_url", None) if loaded_prod else None,
                    uom=it.uom,
                    include_images=bool(it.include_images and _sanitize_crm_image_url(it.selected_image_url)),
                    selected_image_url=_sanitize_crm_image_url(it.selected_image_url),
                    include_specifications=inc_specs,
                    demo_link=it.demo_link,
                    quantity=float(it.quantity),
                    unit_price=float(it.unit_price),
                    unit_discount=float(it.unit_discount),
                    tax_rate=float(it.tax_rate),
                    taxable_amount=float(it.taxable_amount),
                    tax_amount=float(it.tax_amount),
                    total_amount=float(it.total_amount),
                )
            )
        revisions = [
            CrmQuotationVersionRead(
                id=rv.id,
                quotation_id=rv.quotation_id,
                version=rv.version,
                snapshot_data=rv.snapshot_data,
                revision_notes=rv.revision_notes,
                created_by=rv.created_by,
                created_by_name=rv.created_by_name,
                created_at=rv.created_at,
            )
            for rv in (q.revisions or [])
        ]

        # Resolve customer snapshot details
        latest_rev_snapshot = {}
        if q.revisions:
            latest_rev = max(q.revisions, key=lambda r: r.version or 0)
            if latest_rev and isinstance(latest_rev.snapshot_data, dict):
                latest_rev_snapshot = latest_rev.snapshot_data

        lead_obj = getattr(q, "lead", None)
        company_obj = getattr(q, "company", None) or (getattr(lead_obj, "company", None) if lead_obj else None)
        cust_info = resolve_customer_details(
            lead=lead_obj,
            company=company_obj,
            snapshot_data={
                "customer_name_snapshot": q.customer_name_snapshot,
                "customer_designation_snapshot": latest_rev_snapshot.get("customer_designation_snapshot"),
                "customer_phone_snapshot": q.customer_phone_snapshot,
                "customer_email_snapshot": q.customer_email_snapshot,
                "company_name_snapshot": q.company_name_snapshot,
                "billing_address_snapshot": latest_rev_snapshot.get("billing_address_snapshot"),
                "customer_gstin_snapshot": latest_rev_snapshot.get("customer_gstin_snapshot"),
            },
        )

        return CrmSalesQuotationRead(
            id=q.id,
            quotation_number=q.quotation_number,
            lead_id=q.lead_id,
            company_id=q.company_id,
            version=q.version,
            status=q.status,
            quotation_date=q.quotation_date,
            valid_until=q.valid_until,
            currency=q.currency,
            customer_name_snapshot=cust_info["customer_name"] or q.customer_name_snapshot or "—",
            customer_designation_snapshot=cust_info.get("customer_designation"),
            customer_phone_snapshot=cust_info["customer_phone"] or q.customer_phone_snapshot,
            customer_email_snapshot=cust_info["customer_email"] or q.customer_email_snapshot,
            company_name_snapshot=cust_info["company_name"] or q.company_name_snapshot,
            billing_address_snapshot=cust_info.get("billing_address"),
            customer_gstin_snapshot=cust_info.get("customer_gstin"),
            subtotal=float(q.subtotal),
            discount_total=float(q.discount_total),
            tax_total=float(q.tax_total),
            total_amount=float(q.total_amount),
            payment_terms=q.payment_terms,
            delivery_terms=q.delivery_terms,
            notes=q.notes,
            terms_and_conditions=q.terms_and_conditions,
            created_by=q.created_by,
            created_by_name=q.created_by_name,
            created_at=q.created_at,
            updated_at=q.updated_at,
            items=items,
            revisions=revisions,
        )

    async def list_quotation_versions(
        self,
        quotation_id: uuid.UUID,
        *,
        actor: CurrentUser,
    ) -> list[CrmQuotationVersionRead]:
        """List historical revision snapshots of a quotation, enforcing lead scope."""
        q = await self.session.get(CrmSalesQuotation, quotation_id)
        if not q or q.deleted_at is not None:
            raise NotFoundException(f"Quotation with id {quotation_id} not found.")

        lead = await self.session.get(CrmLead, q.lead_id)
        if not lead or lead.deleted_at is not None:
            raise NotFoundException(f"Lead with id {q.lead_id} not found.")

        await self.lead_service._check_lead_scope(lead, actor, action="view")

        stmt = (
            select(CrmQuotationVersion)
            .where(CrmQuotationVersion.quotation_id == quotation_id)
            .order_by(desc(CrmQuotationVersion.version))
        )
        versions = (await self.session.execute(stmt)).scalars().all()

        return [
            CrmQuotationVersionRead(
                id=v.id,
                quotation_id=v.quotation_id,
                version=v.version,
                snapshot_data=v.snapshot_data,
                revision_notes=v.revision_notes,
                created_by=v.created_by,
                created_by_name=v.created_by_name,
                created_at=v.created_at,
            )
            for v in versions
        ]

    async def generate_quotation_pdf(
        self,
        quotation_id: uuid.UUID,
        *,
        version: int | None = None,
        public_origin: str | None = None,
        actor: CurrentUser,
    ) -> tuple[bytes, str]:
        """
        Generate an official PDF from the saved quotation or revision snapshot.
        Enforces CRM lead/company authorization and adds an activity entry (without duplicates).
        Does NOT change quotation status or commercial values.
        """
        from app.crm.quotation_pdf import generate_crm_quotation_pdf_bytes

        stmt = (
            select(CrmSalesQuotation)
            .options(
                selectinload(CrmSalesQuotation.lead).selectinload(CrmLead.company).selectinload(Company.contacts),
                selectinload(CrmSalesQuotation.company).selectinload(Company.contacts),
                selectinload(CrmSalesQuotation.items).selectinload(CrmQuotationItem.product),
                selectinload(CrmSalesQuotation.revisions),
            )
            .where(
                CrmSalesQuotation.id == quotation_id,
                CrmSalesQuotation.deleted_at.is_(None),
            )
        )
        q = (await self.session.execute(stmt)).scalar_one_or_none()
        if not q:
            raise NotFoundException(f"Quotation with id {quotation_id} not found.")

        # RBAC check: Salesperson (assigned only), Manager (department scope), Admin (full access)
        await self.lead_service._check_lead_scope(q.lead, actor, action="view")

        target_version = version or q.version

        # Retrieve saved snapshot data without altering live records or re-evaluating master prices
        if target_version == q.version:
            snapshot_data = self._serialize_quotation(q)
        elif target_version < q.version:
            rev_match = next((r for r in q.revisions if r.version == target_version), None)
            if not rev_match:
                raise NotFoundException(f"Revision version {target_version} not found for quotation {q.quotation_number}.")
            import copy
            snapshot_data = copy.deepcopy(rev_match.snapshot_data)
        else:
            raise NotFoundException(f"Revision version {target_version} does not exist (current version is v{q.version}).")

        # Fetch organization profile from ERP Settings as the single source of truth for company branding
        org_stmt = select(Organization).limit(1)
        org = (await self.session.execute(org_stmt)).scalar_one_or_none()
        company_branding = {
            "company_name": (org.company_name if org and org.company_name else "Inhyma Solutions LLP").strip(),
            "legal_name": org.legal_name.strip() if org and org.legal_name else None,
            "logo_data": org.logo_data if org and org.logo_data else None,
            "logo_url": org.logo_url if org and org.logo_url else None,
            "gst_number": org.gst_number.strip() if org and org.gst_number else None,
            "pan_number": org.pan_number.strip() if org and org.pan_number else None,
            "email": org.email.strip() if org and org.email else None,
            "phone": org.phone.strip() if org and org.phone else None,
            "website": org.website.strip() if org and org.website else None,
            "address": org.address.strip() if org and org.address else None,
            "city": org.city.strip() if org and org.city else None,
            "state": org.state.strip() if org and org.state else None,
            "country": org.country.strip() if org and org.country else None,
            "postal_code": org.postal_code.strip() if org and org.postal_code else None,
        }

        # Deduplicated CRM activity history logging (safeguarded so logging errors never abort PDF generation)
        now = _utcnow()
        try:
            recent_activity_stmt = (
                select(CrmActivity)
                .where(
                    CrmActivity.lead_id == q.lead_id,
                    CrmActivity.activity_type == "quotation_pdf_generated",
                    CrmActivity.subject == f"Quotation PDF generated: {q.quotation_number} (v{target_version})",
                )
                .order_by(desc(CrmActivity.created_at))
            )
            recent_activity = (await self.session.execute(recent_activity_stmt)).scalars().first()

            should_log = False
            if not recent_activity:
                should_log = True
            else:
                rec_created = recent_activity.created_at
                if rec_created.tzinfo is None and now.tzinfo is not None:
                    rec_created = rec_created.replace(tzinfo=timezone.utc)
                elif rec_created.tzinfo is not None and now.tzinfo is None:
                    now = now.replace(tzinfo=timezone.utc)
                elapsed = (now - rec_created).total_seconds()
                if elapsed > 900:  # 15 minute deduplication window
                    should_log = True

            if should_log:
                activity = CrmActivity(
                    lead_id=q.lead_id,
                    activity_type="quotation_pdf_generated",
                    subject=f"Quotation PDF generated: {q.quotation_number} (v{target_version})",
                    description=f"Sales quotation {q.quotation_number} v{target_version} PDF generated by {getattr(actor, 'display_name', None) or getattr(actor, 'username', 'CRM User')}",
                    performed_by=actor.id if actor and getattr(actor, "id", None) else None,
                    activity_at=now,
                    created_at=now,
                )
                self.session.add(activity)
                await self.session.commit()
        except Exception as log_err:
            logger.warning("Could not log quotation PDF generation activity: %s", log_err)
            await self.session.rollback()

        if public_origin:
            clean_origin = public_origin.rstrip("/")
            for snap_item in snapshot_data.get("items") or []:
                raw_spec = snap_item.get("specification")
                if isinstance(raw_spec, str) and raw_spec.strip().startswith("/"):
                    snap_item["specification"] = f"{clean_origin}{raw_spec.strip()}"

        pdf_bytes = generate_crm_quotation_pdf_bytes(snapshot_data, company_branding=company_branding)
        filename = f"{q.quotation_number}_v{target_version}.pdf"
        return pdf_bytes, filename

    async def record_share_activity(
        self,
        quotation_id: uuid.UUID,
        payload: CrmQuotationShareActivityCreate,
        *,
        actor: CurrentUser,
    ) -> dict[str, Any]:
        """
        Record an Email or WhatsApp share attempt/opened event against the lead & quotation.
        Enforces lead scope, deduplicates rapid repeated clicks, and prevents claiming sent/delivered.
        """
        stmt = (
            select(CrmSalesQuotation)
            .options(
                selectinload(CrmSalesQuotation.lead),
            )
            .where(
                CrmSalesQuotation.id == quotation_id,
                CrmSalesQuotation.deleted_at.is_(None),
            )
        )
        q = (await self.session.execute(stmt)).scalar_one_or_none()
        if not q:
            raise NotFoundException(f"Quotation with id {quotation_id} not found.")

        # RBAC check: Salesperson (assigned only), Manager (department scope), Admin (full access)
        await self.lead_service._check_lead_scope(q.lead, actor, action="view")

        target_version = payload.version or q.version
        channel_title = "Email" if payload.channel == "email" else "WhatsApp"

        now = _utcnow()
        # Deduplicate identical share activity recorded within 60 seconds
        recent_stmt = (
            select(CrmActivity)
            .where(
                CrmActivity.lead_id == q.lead_id,
                CrmActivity.activity_type == payload.channel,
                CrmActivity.outcome == payload.outcome,
                CrmActivity.subject == f"{channel_title} share {payload.outcome}: {q.quotation_number} (v{target_version})",
            )
            .order_by(desc(CrmActivity.created_at))
        )
        recent = (await self.session.execute(recent_stmt)).scalars().first()
        if recent:
            rec_created = recent.created_at
            if rec_created.tzinfo is None and now.tzinfo is not None:
                rec_created = rec_created.replace(tzinfo=timezone.utc)
            elif rec_created.tzinfo is not None and now.tzinfo is None:
                now = now.replace(tzinfo=timezone.utc)
            elapsed = (now - rec_created).total_seconds()
            if elapsed < 60:
                return {
                    "success": True,
                    "deduplicated": True,
                    "activity_id": str(recent.id),
                    "channel": payload.channel,
                    "outcome": payload.outcome,
                }

        actor_name = getattr(actor, "display_name", None) or getattr(actor, "username", "CRM User")
        desc_parts = [
            f"Quotation {q.quotation_number} v{target_version} {payload.channel} share {payload.outcome} by {actor_name}."
        ]
        if payload.recipient:
            desc_parts.append(f"Recipient: {payload.recipient.strip()}")
        if payload.details:
            desc_parts.append(f"Details: {payload.details.strip()}")

        activity = CrmActivity(
            lead_id=q.lead_id,
            activity_type=payload.channel,
            subject=f"{channel_title} share {payload.outcome}: {q.quotation_number} (v{target_version})",
            description=" | ".join(desc_parts),
            outcome=payload.outcome,
            performed_by=actor.id,
            activity_at=now,
            created_at=now,
        )
        self.session.add(activity)
        q.lead.updated_at = now
        await self.session.commit()

        return {
            "success": True,
            "deduplicated": False,
            "activity_id": str(activity.id),
            "channel": payload.channel,
            "outcome": payload.outcome,
        }
