"""
Public Supplier Quotation Submission API.

Provides unauthenticated (token-protected) endpoints for external suppliers
to view RFQ specifications and submit their quotations directly into the ERP.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import AuditService
from app.core.config import settings
from app.core.responses import build_success_response
from app.database.session import get_db_session
from app.events.channels import module_channel
from app.events.dependencies import get_event_dispatcher
from app.events.dispatcher import EventDispatcher
from app.events.models import Event
from app.inquiries.models import Inquiry, InquiryItem, Quotation, QuotationStatus, RFQ
from app.masters.products.models import Product
from app.masters.uom.models import UnitOfMeasurement
from app.buyers.models import Buyer
from app.suppliers.models import Supplier

router = APIRouter(prefix="/public/rfq", tags=["Public Supplier RFQ"])


from app.common.rate_limit import enforce_rate_limit, public_rfq_limiter

DEFAULT_RFQ_TOKEN_EXPIRE_DAYS = 7
RFQ_TOKEN_AUDIENCE = "rfq_portal"
RFQ_TOKEN_ISSUER = "yinglima_erp"
RFQ_TOKEN_PURPOSE = "supplier_rfq"


def generate_rfq_token(
    rfq_id: uuid.UUID,
    item_id: uuid.UUID,
    supplier_id: uuid.UUID,
    expires_in_days: int = DEFAULT_RFQ_TOKEN_EXPIRE_DAYS,
) -> str:
    """Generate a cryptographically signed token for supplier's private quotation submission."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": RFQ_TOKEN_PURPOSE,
        "aud": RFQ_TOKEN_AUDIENCE,
        "iss": RFQ_TOKEN_ISSUER,
        "rfq_id": str(rfq_id),
        "item_id": str(item_id) if item_id else None,
        "supplier_id": str(supplier_id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=expires_in_days)).timestamp()),
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm="HS256")


def decode_rfq_token(token: str) -> dict[str, Any]:
    """Decode and validate a supplier RFQ token with signature, audience, and expiry verification."""
    clean_token = token.strip()
    try:
        payload = jwt.decode(
            clean_token,
            settings.JWT_SECRET_KEY,
            algorithms=["HS256"],
            audience=RFQ_TOKEN_AUDIENCE,
            issuer=RFQ_TOKEN_ISSUER,
            options={
                "require": ["exp", "sub", "aud", "iss", "rfq_id", "supplier_id"],
                "verify_exp": True,
                "verify_aud": True,
                "verify_iss": True,
            },
        )
        if payload.get("sub") != RFQ_TOKEN_PURPOSE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid quotation link token purpose.",
            )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This Request for Quotation link has expired.",
        )
    except (jwt.InvalidAudienceError, jwt.InvalidIssuerError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid quotation link audience or issuer.",
        )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or forged quotation link token.",
        )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid quotation link token.",
        )


class PublicSupplierQuoteSubmit(BaseModel):
    unit_price: float = Field(..., gt=0, description="Unit Price in quoted currency")
    quantity: float | None = Field(default=None, gt=0, description="Quoted quantity")
    currency: str = Field(default="CNY", max_length=10, description="Currency e.g. CNY, USD, INR")
    expected_receiving_date: str | None = Field(default=None, description="Expected delivery date or lead time")
    terms_and_conditions: str | None = Field(default=None, description="Payment terms, warranty, MOQ, etc.")
    remarks: str | None = Field(default=None, description="Additional notes or specifications")


@router.get("/{token}")
async def get_public_rfq_details(
    token: str,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """Fetch public RFQ details for the supplier to review product requirements."""
    enforce_rate_limit(public_rfq_limiter, request, key_suffix=token[:16])
    token_data = decode_rfq_token(token)
    rfq_id = uuid.UUID(token_data["rfq_id"])
    supplier_id = uuid.UUID(token_data["supplier_id"])

    # Load RFQ
    rfq_stmt = select(RFQ).where(RFQ.id == rfq_id, RFQ.deleted_at.is_(None))
    rfq = (await db.execute(rfq_stmt)).scalar_one_or_none()
    if not rfq:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request for Quotation not found or expired.")

    item_id = rfq.inquiry_item_id

    # Load Item
    item_stmt = select(InquiryItem).where(InquiryItem.id == item_id, InquiryItem.deleted_at.is_(None))
    item = (await db.execute(item_stmt)).scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inquiry item not found or expired.")

    # Load Product
    prod: Product | None = None
    product_name = item.product_specs_remarks or "Product"
    product_code = "N/A"
    uom_name = "NOS"
    if item.product_id:
        prod = (await db.execute(select(Product).where(Product.id == item.product_id))).scalar_one_or_none()
        if prod:
            product_name = prod.product_name_tally or prod.product_name
            product_code = prod.product_code or "N/A"
            if prod.uom_id:
                uom = (await db.execute(select(UnitOfMeasurement).where(UnitOfMeasurement.id == prod.uom_id))).scalar_one_or_none()
                if uom:
                    uom_name = uom.name

    # Load Supplier
    supplier_stmt = select(Supplier).where(Supplier.id == supplier_id)
    supplier = (await db.execute(supplier_stmt)).scalar_one_or_none()

    # Load Buyer / Inquiry
    inquiry_stmt = select(Inquiry).where(Inquiry.id == item.inquiry_id)
    inquiry = (await db.execute(inquiry_stmt)).scalar_one_or_none()
    buyer_name = "Buyer Company"
    if inquiry and inquiry.buyer_id:
        buyer = (await db.execute(select(Buyer).where(Buyer.id == inquiry.buyer_id))).scalar_one_or_none()
        if buyer:
            buyer_name = buyer.company_name or "Buyer Company"

    # Check if a quote was already submitted by this supplier for this item
    existing_quote_stmt = select(Quotation).where(
        Quotation.inquiry_item_id == item_id,
        Quotation.supplier_id == supplier_id,
        Quotation.deleted_at.is_(None),
    )
    existing_quote = (await db.execute(existing_quote_stmt)).scalars().first()

    data = {
        "item_id": str(item.id),
        "rfq_id": str(rfq.id) if rfq else str(rfq_id),
        "supplier_id": str(supplier_id),
        "supplier_name": supplier.company_name if supplier else "Valued Supplier",
        "buyer_company_name": buyer_name,
        "product_name": product_name,
        "product_code": product_code,
        "quantity": item.quantity,
        "uom_name": uom_name,
        "brand_preference": item.brand_preference,
        "product_specs_remarks": item.product_specs_remarks,
        "procurement_remarks": item.procurement_remarks,
        "expected_receiving_date": str(rfq.expected_receiving_date) if rfq and rfq.expected_receiving_date else None,
        "rfq_notes": rfq.notes if rfq else None,
        "packaging_quantity": prod.packaging_quantity if prod and prod.packaging_quantity is not None else None,
        "packaging_gross_weight": prod.packaging_gross_weight if prod and prod.packaging_gross_weight is not None else None,
        "packaging_unit_cbm": prod.packaging_unit_cbm if prod and prod.packaging_unit_cbm is not None else None,
        "already_submitted": bool(existing_quote),
        "submitted_quote": {
            "quote_number": existing_quote.quote_number,
            "unit_price": existing_quote.unit_price if existing_quote.unit_price is not None else None,
            "total_cost": existing_quote.total_cost if existing_quote.total_cost is not None else None,
            "currency": existing_quote.currency,
            "expected_receiving_date": str(existing_quote.expected_receiving_date) if existing_quote.expected_receiving_date else None,
            "terms_and_conditions": existing_quote.terms_and_conditions,
            "remarks": existing_quote.remarks,
            "created_at": existing_quote.created_at.isoformat() if existing_quote.created_at else None,
        } if existing_quote else None,
    }

    return build_success_response(
        data=data,
        request_id=request.state.request_id,
        message="RFQ details loaded successfully.",
    )


@router.post("/{token}/submit", status_code=status.HTTP_201_CREATED)
async def submit_public_rfq_quotation(
    token: str,
    payload: PublicSupplierQuoteSubmit,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    dispatcher: EventDispatcher = Depends(get_event_dispatcher),
) -> dict:
    """Submit a quotation from the supplier for the specified RFQ."""
    enforce_rate_limit(public_rfq_limiter, request, key_suffix=token[:16])
    token_data = decode_rfq_token(token)
    rfq_id = uuid.UUID(token_data["rfq_id"])
    supplier_id = uuid.UUID(token_data["supplier_id"])

    # Load RFQ to get item_id and creator user_id
    rfq_stmt = select(RFQ).where(RFQ.id == rfq_id)
    rfq = (await db.execute(rfq_stmt)).scalar_one_or_none()
    if not rfq:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request for Quotation not found.")

    item_id = rfq.inquiry_item_id
    creator_id = rfq.created_by

    # Load Item
    item_stmt = select(InquiryItem).where(InquiryItem.id == item_id, InquiryItem.deleted_at.is_(None))
    item = (await db.execute(item_stmt)).scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inquiry item not found.")

    # Parse expected date if provided
    exp_date: date | None = None
    if payload.expected_receiving_date:
        try:
            exp_date = date.fromisoformat(payload.expected_receiving_date.strip()[:10])
        except ValueError:
            exp_date = None

    quote_qty = payload.quantity if payload.quantity and payload.quantity > 0 else item.quantity
    total_cost = round(quote_qty * payload.unit_price, 2)

    # Generate sequential quote number
    quote_number = f"QT-{uuid.uuid4().hex[:6].upper()}"

    quotation = Quotation(
        quote_number=quote_number,
        inquiry_item_id=item_id,
        supplier_id=supplier_id,
        quantity=quote_qty,
        unit_price=payload.unit_price,
        total_cost=total_cost,
        currency=payload.currency.upper() if payload.currency else "CNY",
        expected_receiving_date=exp_date,
        terms_and_conditions=payload.terms_and_conditions.strip() if payload.terms_and_conditions else None,
        remarks=payload.remarks.strip() if payload.remarks else None,
        status=QuotationStatus.PENDING,
        created_by=creator_id,
    )

    db.add(quotation)
    await db.commit()
    await db.refresh(quotation)

    # Broadcast live real-time event to all connected ERP screens
    try:
        event = Event(
            event_type="quotation.created",
            entity="inquiry",
            entity_id=str(item_id),
            version=None,
            user_id=str(creator_id),
            changes={
                "quote_id": str(quotation.id),
                "quote_number": quotation.quote_number,
                "supplier_id": str(quotation.supplier_id),
                "inquiry_item_id": str(item_id),
                "inquiry_id": str(item.inquiry_id),
                "total_cost": quotation.total_cost,
                "unit_price": quotation.unit_price,
            },
        )
        await dispatcher.publish(module_channel("inquiries"), event)
    except Exception:
        pass

    return build_success_response(
        data={
            "id": str(quotation.id),
            "quote_number": quotation.quote_number,
            "supplier_id": str(quotation.supplier_id),
            "quantity": quotation.quantity,
            "unit_price": quotation.unit_price,
            "total_cost": quotation.total_cost,
            "currency": quotation.currency,
            "status": quotation.status.value if hasattr(quotation.status, "value") else str(quotation.status),
            "created_at": quotation.created_at.isoformat() if quotation.created_at else None,
        },
        request_id=request.state.request_id,
        message="Quotation submitted successfully. Thank you!",
    )
