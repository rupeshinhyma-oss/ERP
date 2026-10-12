"""Unit and workflow tests for Technician Spare Parts Gatepass, Wallet Management & Warranty System."""

from __future__ import annotations

import uuid
from datetime import date, timedelta
import pytest

from app.technician_operations.models import MachineWarranty, TechnicianGatepass, TechnicianGatepassItem
from app.technician_operations.schemas import (
    DraftSOGenerationResponse,
    GatepassCreate,
    GatepassItemCreate,
    GatepassItemReturnPayload,
    GatepassLinkSOPayload,
    GatepassReturnPayload,
    TechnicianWalletSummary,
    WalletTransactionCreate,
    WarrantyRegisterPayload,
    WarrantyValidationResult,
)


def test_warranty_lifecycle_under_vs_out_of_warranty():
    """Verify warranty expiration calculation based on machine invoice date and duration."""
    today = date.today()

    # Case 1: Machine invoiced 60 days ago with 365 days warranty -> UNDER_WARRANTY
    recent_invoice = today - timedelta(days=60)
    warranty_under = MachineWarranty(
        serial_number="SN-INHYMA-1001",
        machine_model="SuperSealer 5000",
        company_name="Apex Packaging Ltd",
        invoice_date=recent_invoice,
        warranty_months=12,
        warranty_end_date=recent_invoice + timedelta(days=365),
        status="UNDER_WARRANTY",
    )
    assert warranty_under.is_currently_covered() is True

    # Case 2: Machine invoiced 500 days ago with 365 days warranty -> OUT_OF_WARRANTY
    old_invoice = today - timedelta(days=500)
    warranty_expired = MachineWarranty(
        serial_number="SN-INHYMA-0082",
        machine_model="CartonMaster 300",
        company_name="Zenith Foods Ltd",
        invoice_date=old_invoice,
        warranty_months=12,
        warranty_end_date=old_invoice + timedelta(days=365),
        status="OUT_OF_WARRANTY",
    )
    assert warranty_expired.is_currently_covered() is False

    # Case 3: Voided warranty status
    warranty_void = MachineWarranty(
        serial_number="SN-INHYMA-0999",
        machine_model="PackBot X",
        company_name="Delta Beverages",
        invoice_date=recent_invoice,
        warranty_months=12,
        warranty_end_date=recent_invoice + timedelta(days=365),
        status="VOIDED",
    )
    assert warranty_void.is_currently_covered() is False


def test_gatepass_create_and_item_schema():
    """Verify Gatepass issuance payload structure."""
    item1 = GatepassItemCreate(
        product_name="Heating Element 240V 1kW",
        product_code="SP-HEAT-01",
        uom="NOS",
        quantity_issued=2.0,
        unit_rate=1250.0,
        remarks="Field replacement for sealing jaw",
    )
    item2 = GatepassItemCreate(
        product_name="PTFE Teflon Tape 10m",
        product_code="SP-TEF-05",
        uom="ROLL",
        quantity_issued=3.0,
        unit_rate=450.0,
    )

    gp_payload = GatepassCreate(
        technician_name="Ramesh Kumar",
        technician_mobile="9876543210",
        customer_name="Apex Packaging Ltd",
        machine_serial_number="SN-INHYMA-1001",
        purpose="Emergency breakdown service call",
        items=[item1, item2],
    )

    assert gp_payload.technician_name == "Ramesh Kumar"
    assert len(gp_payload.items) == 2
    assert gp_payload.items[0].quantity_issued == 2.0
    assert gp_payload.items[1].unit_rate == 450.0


def test_partial_return_consumed_parts_so_requirement():
    """
    Core business rule:
    When parts are returned partially, verify whether a Sales Order was created for the consumed parts.
    If consumed parts are not under warranty, so_required must be True.
    """
    gp_id = uuid.uuid4()
    item1_id = uuid.uuid4()
    item2_id = uuid.uuid4()

    # Technician issued 2 heating elements and 3 teflon rolls
    item1 = TechnicianGatepassItem(
        id=item1_id,
        gatepass_id=gp_id,
        product_name="Heating Element 240V 1kW",
        quantity_issued=2.0,
        quantity_consumed=0.0,
        quantity_returned=0.0,
        unit_rate=1250.0,
        is_warranty_covered=False,  # Not under warranty -> Chargeable!
        item_status="ISSUED",
    )
    item2 = TechnicianGatepassItem(
        id=item2_id,
        gatepass_id=gp_id,
        product_name="PTFE Teflon Tape 10m",
        quantity_issued=3.0,
        quantity_consumed=0.0,
        quantity_returned=0.0,
        unit_rate=450.0,
        is_warranty_covered=False,
        item_status="ISSUED",
    )

    gatepass = TechnicianGatepass(
        id=gp_id,
        gatepass_number="GP-TECH-2026-0001",
        technician_name="Ramesh Kumar",
        customer_name="Apex Packaging Ltd",
        is_warranty_service=False,
        issue_date=date.today(),
        issued_by_name="Warehouse Manager",
        purpose="Breakdown service call",
        status="ISSUED",
        so_required=False,
        so_created=False,
        items=[item1, item2],
    )

    # Return payload:
    # Item 1: 1 returned, 1 consumed
    # Item 2: 2 returned, 1 consumed
    return_payload = GatepassReturnPayload(
        return_gatepass_number="RGP-TECH-2026-0001",
        notes="Customer accepted replacement of 1 heating element and 1 roll teflon",
        items=[
            GatepassItemReturnPayload(
                item_id=item1_id,
                quantity_returned=1.0,
                quantity_consumed=1.0,
                is_warranty_covered=False,
                item_status="CONSUMED_BILLED",
            ),
            GatepassItemReturnPayload(
                item_id=item2_id,
                quantity_returned=2.0,
                quantity_consumed=1.0,
                is_warranty_covered=False,
                item_status="CONSUMED_BILLED",
            ),
        ],
    )

    # Simulate reconciliation
    has_chargeable_consumed = False
    for ret_item in return_payload.items:
        matching = next(i for i in gatepass.items if i.id == ret_item.item_id)
        matching.quantity_returned = ret_item.quantity_returned
        matching.quantity_consumed = ret_item.quantity_consumed
        matching.is_warranty_covered = ret_item.is_warranty_covered
        if matching.quantity_consumed > 0 and not matching.is_warranty_covered:
            has_chargeable_consumed = True

    assert has_chargeable_consumed is True
    gatepass.so_required = has_chargeable_consumed
    gatepass.status = "PARTIALLY_RETURNED"

    assert gatepass.so_required is True
    assert gatepass.so_created is False
    assert gatepass.status == "PARTIALLY_RETURNED"

    # Now salesperson creates and links the Sales Order
    link_so_payload = GatepassLinkSOPayload(sales_order_number="SO-2026-0842")
    gatepass.so_number = link_so_payload.sales_order_number
    gatepass.so_created = True

    total_issued = sum(i.quantity_issued for i in gatepass.items)
    total_accounted = sum(i.quantity_consumed + i.quantity_returned for i in gatepass.items)
    assert total_issued == 5.0
    assert total_accounted == 5.0

    if total_accounted >= total_issued:
        gatepass.status = "CLOSED"

    assert gatepass.status == "CLOSED"
    assert gatepass.so_number == "SO-2026-0842"
    assert gatepass.so_created is True


def test_technician_wallet_balance_ledger_math():
    """
    Verify technician cash/wallet balance tracking:
    Net Balance = Collections - Handover Deposits - Approved Field Expenses
    """
    # Technician collected ₹15,000 from Customer A (Cash)
    t1 = WalletTransactionCreate(
        technician_name="Ramesh Kumar",
        customer_name="Apex Packaging Ltd",
        transaction_type="COLLECTION",
        amount=15000.0,
        payment_mode="Cash",
    )
    # Technician collected ₹5,000 from Customer B (Cash)
    t2 = WalletTransactionCreate(
        technician_name="Ramesh Kumar",
        customer_name="Zenith Foods Ltd",
        transaction_type="COLLECTION",
        amount=5000.0,
        payment_mode="Cash",
    )
    # Technician handed over ₹12,000 to Accounts desk
    t3 = WalletTransactionCreate(
        technician_name="Ramesh Kumar",
        transaction_type="HANDOVER_DEPOSIT",
        amount=12000.0,
        payment_mode="Cash Deposit",
    )
    # Technician incurred ₹1,500 fuel & emergency toll expense
    t4 = WalletTransactionCreate(
        technician_name="Ramesh Kumar",
        transaction_type="FIELD_EXPENSE",
        amount=1500.0,
        payment_mode="Cash",
        notes="Travel & Toll to customer factory",
    )

    transactions = [t1, t2, t3, t4]

    coll = sum(t.amount for t in transactions if t.transaction_type == "COLLECTION")
    dep = sum(t.amount for t in transactions if t.transaction_type == "HANDOVER_DEPOSIT")
    exp = sum(t.amount for t in transactions if t.transaction_type == "FIELD_EXPENSE")
    net_balance = round(coll - dep - exp, 2)

    assert coll == 20000.0
    assert dep == 12000.0
    assert exp == 1500.0
    assert net_balance == 6500.0  # ₹6,500 cash in hand pending handover to Accounts

    summary = TechnicianWalletSummary(
        technician_name="Ramesh Kumar",
        total_collected=coll,
        total_deposited=dep,
        total_expenses=exp,
        net_wallet_balance=net_balance,
        status="PENDING_DEPOSIT" if net_balance > 0 else "CLEAR",
    )

    assert summary.status == "PENDING_DEPOSIT"
    assert summary.net_wallet_balance == 6500.0


def test_draft_so_generation_formatting():
    """Verify draft SO generation response format for salesperson."""
    items = [
        {
            "gatepass_item_id": str(uuid.uuid4()),
            "product_code": "SP-001",
            "product_name": "Sealing Blade 400mm",
            "quantity": 2.0,
            "unit_rate": 800.0,
            "line_total": 1600.0,
        }
    ]
    draft = DraftSOGenerationResponse(
        customer_name="Apex Packaging Ltd",
        machine_serial_number="SN-INHYMA-1001",
        gatepass_number="GP-TECH-2026-0001",
        items_to_bill=items,
        estimated_subtotal=1600.0,
        message="Ready to bill: 1 item(s) consumed.",
    )

    assert draft.estimated_subtotal == 1600.0
    assert len(draft.items_to_bill) == 1
    assert draft.gatepass_number == "GP-TECH-2026-0001"
