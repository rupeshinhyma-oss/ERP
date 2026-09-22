"""
Unit Tests for Sales Modules (Proforma Invoices, Sales Process, Discount Payments).
"""

from __future__ import annotations

import uuid
from datetime import date
import pytest

from app.sales.models import (
    ProformaInvoice,
    ProformaInvoiceLineItem,
    SaleOrder,
    SaleOrderItem,
    DiscountPayment,
)
from app.sales.schemas import (
    ProformaInvoiceCreate,
    ProformaInvoiceRead,
    DiscountPaymentCreate,
    SaleOrderCreate,
    SaleOrderItemCreate,
)
from app.sales.repository import SaleRepository


def test_proforma_invoice_model():
    pi_id = uuid.uuid4()
    pi = ProformaInvoice(
        id=pi_id,
        proforma_no="PI-MH/26-27/1707",
        proforma_date="21-09-2026",
        expected_delivery_date="21-09-2026",
        warehouse="Mumbai",
        lead_source="Direct",
        company_name="PRINT WORLD CORPORATION",
        city="Pune",
        state="Maharashtra",
        sales_person="Deepika Samel",
        amount_inc_gst=90742.0,
        discount=0.0,
        status="pending",
        remark="Test remark",
        created_by="Deepika Samel",
    )
    assert pi.proforma_no == "PI-MH/26-27/1707"
    assert pi.company_name == "PRINT WORLD CORPORATION"
    assert pi.status == "pending"
    assert pi.amount_inc_gst == 90742.0


def test_proforma_invoice_create_schema():
    payload = ProformaInvoiceCreate(
        proforma_date="21-09-2026",
        expected_delivery_date="21-09-2026",
        warehouse="Mumbai",
        company_name="PRINT WORLD CORPORATION",
        sales_person="Deepika Samel",
        amount_inc_gst=90742.0,
        discount=0.0,
        status="pending",
    )
    assert payload.company_name == "PRINT WORLD CORPORATION"
    assert payload.status == "pending"


def test_discount_payment_model_and_schema():
    dp = DiscountPayment(
        payment_no="DP-26-27/0042",
        payment_date="20-09-2026",
        order_ref="PI-MH/26-27/1707",
        customer_name="PRINT WORLD CORPORATION",
        sales_person="Deepika Samel",
        total_order_amount=90742.0,
        discount_percent=5.0,
        discount_amount=4537.1,
        net_payable=86204.9,
        status="approved",
        remarks="Volume commitment discount",
        created_by="Deepika Samel",
    )
    assert dp.payment_no == "DP-26-27/0042"
    assert dp.status == "approved"
    assert dp.discount_amount == 4537.1

    schema = DiscountPaymentCreate(
        order_ref="PI-MH/26-27/1707",
        customer_name="PRINT WORLD CORPORATION",
        sales_person="Deepika Samel",
        total_order_amount=90742.0,
        discount_percent=5.0,
    )
    assert schema.order_ref == "PI-MH/26-27/1707"
    assert schema.discount_percent == 5.0



def test_sale_order_model():
    so = SaleOrder(
        order_no="SO-INH/26-27/0001",
        organization_id=uuid.uuid4(),
        organization_name="Inhyma",
        buyer_id=uuid.uuid4(),
        buyer_name="V S Machines",
        order_date="21-09-2026",
        delivery_date="25-09-2026",
        currency="INR",
        status="pending",
        total_basic=230000.0,
        total_tax=41400.0,
        total_amount=271400.0,
        total_quantity=1.0,
    )
    assert so.order_no.startswith("SO-INH/")
    assert so.buyer_name == "V S Machines"
    assert so.total_amount == 271400.0
