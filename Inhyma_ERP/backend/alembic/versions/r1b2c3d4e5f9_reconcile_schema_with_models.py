"""reconcile_schema_with_models

Brings a database built from the migration chain into line with the SQLAlchemy models.

Until now several tables existed only because the app created them at startup (``create_all``) or because
a one-off script did, so a database built from migrations alone was missing them -- and columns added to
existing tables by the models were never migrated, so every query on those tables failed. This migration
creates what is missing and adds what is missing. It is idempotent: anything that already exists (for
example on the live database, which was partly built by ``create_all``) is left untouched.

Tables created:  agents, discount_payments, follow_ups, hrms_site_visit_checkins, industrial_zones, leads, sales_orders, technical_task_call_logs, sales_order_items
Columns added:   companies(10), hrms_leave_plan_types(1), hrms_leave_adjustments(1), hrms_site_visits(2), hrms_tracking_sessions(5), hrms_payroll_components(1), hrms_monthly_payroll_items(1), product_stocks(2), technical_tasks(10)

The downgrade is intentionally a no-op: on a database where these tables already existed before this
migration, dropping them would destroy real data.

Revision ID: r1b2c3d4e5f9
Revises: p1b2c3d4e5f8
Create Date: 2026-10-08 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.database.base import GUID

revision: str = "r1b2c3d4e5f9"
down_revision: Union[str, None] = "p1b2c3d4e5f8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(insp, name: str) -> bool:
    return insp.has_table(name)


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    # ---- agents
    if not _has_table(insp, 'agents'):
        op.create_table(
            'agents',
            sa.Column('full_name', sa.String(150), nullable=False),
            sa.Column('agent_type', sa.String(100), nullable=False),
            sa.Column('company_name', sa.String(200), nullable=True),
            sa.Column('work_description', sa.Text(), nullable=True),
            sa.Column('calling_number', sa.String(50), nullable=False),
            sa.Column('whatsapp_number', sa.String(50), nullable=True),
            sa.Column('state', sa.String(100), nullable=False),
            sa.Column('district', sa.String(100), nullable=False),
            sa.Column('city', sa.String(100), nullable=False),
            sa.Column('area', sa.String(150), nullable=True),
            sa.Column('address', sa.Text(), nullable=True),
            sa.Column('birth_date', sa.Date(), nullable=True),
            sa.Column('age', sa.Integer(), nullable=True),
            sa.Column('agent_grade', sa.String(50), nullable=True),
            sa.Column('current_status', sa.String(50), nullable=False),
            sa.Column('potential', sa.String(50), nullable=False),
            sa.Column('sales_person', sa.String(150), nullable=True),
            sa.Column('remarks', sa.Text(), nullable=True),
            sa.Column('added_on', sa.Date(), nullable=False),
            sa.Column('id', GUID(), primary_key=True),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('version', sa.Integer(), nullable=False, server_default=sa.text('1')),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index('ix_agents_added_on', 'agents', ['added_on'], unique=False)
        op.create_index('ix_agents_agent_grade', 'agents', ['agent_grade'], unique=False)
        op.create_index('ix_agents_agent_type', 'agents', ['agent_type'], unique=False)
        op.create_index('ix_agents_calling_number', 'agents', ['calling_number'], unique=False)
        op.create_index('ix_agents_city', 'agents', ['city'], unique=False)
        op.create_index('ix_agents_company_name', 'agents', ['company_name'], unique=False)
        op.create_index('ix_agents_current_status', 'agents', ['current_status'], unique=False)
        op.create_index('ix_agents_district', 'agents', ['district'], unique=False)
        op.create_index('ix_agents_full_name', 'agents', ['full_name'], unique=False)
        op.create_index('ix_agents_potential', 'agents', ['potential'], unique=False)
        op.create_index('ix_agents_sales_person', 'agents', ['sales_person'], unique=False)
        op.create_index('ix_agents_state', 'agents', ['state'], unique=False)
        op.create_index('ix_agents_whatsapp_number', 'agents', ['whatsapp_number'], unique=False)

    # ---- discount_payments
    if not _has_table(insp, 'discount_payments'):
        op.create_table(
            'discount_payments',
            sa.Column('payment_no', sa.String(50), nullable=False),
            sa.Column('payment_date', sa.String(50), nullable=False),
            sa.Column('order_ref', sa.String(100), nullable=False),
            sa.Column('customer_name', sa.String(255), nullable=False),
            sa.Column('sales_person', sa.String(150), nullable=True),
            sa.Column('warehouse', sa.String(100), nullable=True),
            sa.Column('contact_person_name', sa.String(150), nullable=True),
            sa.Column('contact_person_mobile', sa.String(50), nullable=True),
            sa.Column('total_order_amount', sa.Float(), nullable=False),
            sa.Column('discount_percent', sa.Float(), nullable=False),
            sa.Column('discount_amount', sa.Float(), nullable=False),
            sa.Column('paid_discount', sa.Float(), nullable=False),
            sa.Column('due_discount', sa.Float(), nullable=False),
            sa.Column('net_payable', sa.Float(), nullable=False),
            sa.Column('status', sa.String(30), nullable=False),
            sa.Column('status_updated_at', sa.String(50), nullable=True),
            sa.Column('settled', sa.Boolean(), nullable=False),
            sa.Column('gatepass_id', sa.String(50), nullable=True),
            sa.Column('gatepass_date', sa.String(50), nullable=True),
            sa.Column('settle_date', sa.String(50), nullable=True),
            sa.Column('settle_remarks', sa.Text(), nullable=True),
            sa.Column('remarks', sa.Text(), nullable=True),
            sa.Column('created_by', sa.String(100), nullable=False),
            sa.Column('id', GUID(), primary_key=True),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index('ix_discount_payments_customer_name', 'discount_payments', ['customer_name'], unique=False)
        op.create_index('ix_discount_payments_order_ref', 'discount_payments', ['order_ref'], unique=False)
        op.create_index('ix_discount_payments_payment_no', 'discount_payments', ['payment_no'], unique=True)
        op.create_index('ix_discount_payments_status', 'discount_payments', ['status'], unique=False)

    # ---- follow_ups
    if not _has_table(insp, 'follow_ups'):
        op.create_table(
            'follow_ups',
            sa.Column('company_name', sa.String(255), nullable=False),
            sa.Column('contact_person', sa.String(150), nullable=True),
            sa.Column('contact_phone', sa.String(50), nullable=True),
            sa.Column('contact_email', sa.String(100), nullable=True),
            sa.Column('designation', sa.String(100), nullable=True),
            sa.Column('business_type', sa.String(100), nullable=True),
            sa.Column('client_grade', sa.String(50), nullable=True),
            sa.Column('potential_type', sa.String(50), nullable=True),
            sa.Column('business_category', sa.String(100), nullable=True),
            sa.Column('category', sa.String(100), nullable=True),
            sa.Column('call_type', sa.String(50), nullable=True),
            sa.Column('call_category', sa.String(100), nullable=True),
            sa.Column('marketing_person', sa.String(150), nullable=True),
            sa.Column('current_status', sa.String(50), nullable=False),
            sa.Column('feedback', sa.Text(), nullable=True),
            sa.Column('address', sa.String(255), nullable=True),
            sa.Column('area', sa.String(150), nullable=True),
            sa.Column('city', sa.String(100), nullable=True),
            sa.Column('district', sa.String(100), nullable=True),
            sa.Column('state', sa.String(100), nullable=True),
            sa.Column('followup_date', sa.Date(), nullable=True),
            sa.Column('added_on', sa.Date(), nullable=False),
            sa.Column('notes', sa.Text(), nullable=True),
            sa.Column('id', GUID(), primary_key=True),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('version', sa.Integer(), nullable=False, server_default=sa.text('1')),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index('ix_follow_ups_added_on', 'follow_ups', ['added_on'], unique=False)
        op.create_index('ix_follow_ups_business_category', 'follow_ups', ['business_category'], unique=False)
        op.create_index('ix_follow_ups_business_type', 'follow_ups', ['business_type'], unique=False)
        op.create_index('ix_follow_ups_call_category', 'follow_ups', ['call_category'], unique=False)
        op.create_index('ix_follow_ups_call_type', 'follow_ups', ['call_type'], unique=False)
        op.create_index('ix_follow_ups_category', 'follow_ups', ['category'], unique=False)
        op.create_index('ix_follow_ups_city', 'follow_ups', ['city'], unique=False)
        op.create_index('ix_follow_ups_client_grade', 'follow_ups', ['client_grade'], unique=False)
        op.create_index('ix_follow_ups_company_name', 'follow_ups', ['company_name'], unique=False)
        op.create_index('ix_follow_ups_current_status', 'follow_ups', ['current_status'], unique=False)
        op.create_index('ix_follow_ups_district', 'follow_ups', ['district'], unique=False)
        op.create_index('ix_follow_ups_followup_date', 'follow_ups', ['followup_date'], unique=False)
        op.create_index('ix_follow_ups_marketing_person', 'follow_ups', ['marketing_person'], unique=False)
        op.create_index('ix_follow_ups_potential_type', 'follow_ups', ['potential_type'], unique=False)
        op.create_index('ix_follow_ups_state', 'follow_ups', ['state'], unique=False)

    # ---- hrms_site_visit_checkins
    if not _has_table(insp, 'hrms_site_visit_checkins'):
        op.create_table(
            'hrms_site_visit_checkins',
            sa.Column('site_visit_id', GUID(), nullable=False),
            sa.Column('employee_id', GUID(), nullable=False),
            sa.Column('event_type', sa.String(50), nullable=False),
            sa.Column('latitude', sa.Float(), nullable=False),
            sa.Column('longitude', sa.Float(), nullable=False),
            sa.Column('accuracy', sa.Float(), nullable=True),
            sa.Column('address', sa.String(500), nullable=True),
            sa.Column('captured_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('id', GUID(), primary_key=True),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(['site_visit_id'], ['hrms_site_visits.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['employee_id'], ['users.id'], ondelete='CASCADE'),
        )
        op.create_index('ix_hrms_site_visit_checkins_captured_at', 'hrms_site_visit_checkins', ['captured_at'], unique=False)
        op.create_index('ix_hrms_site_visit_checkins_employee_id', 'hrms_site_visit_checkins', ['employee_id'], unique=False)
        op.create_index('ix_hrms_site_visit_checkins_site_visit_id', 'hrms_site_visit_checkins', ['site_visit_id'], unique=False)

    # ---- industrial_zones
    if not _has_table(insp, 'industrial_zones'):
        op.create_table(
            'industrial_zones',
            sa.Column('zone_name', sa.String(255), nullable=False),
            sa.Column('state', sa.String(100), nullable=False),
            sa.Column('district', sa.String(100), nullable=False),
            sa.Column('nearby_city', sa.String(100), nullable=True),
            sa.Column('distance_km', sa.Float(), nullable=True),
            sa.Column('num_industries', sa.Integer(), nullable=True),
            sa.Column('zone_grade', sa.String(10), nullable=True),
            sa.Column('industry_types', sa.String(255), nullable=True),
            sa.Column('potential_machine_categories', sa.String(255), nullable=True),
            sa.Column('remarks', sa.Text(), nullable=True),
            sa.Column('id', GUID(), primary_key=True),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('version', sa.Integer(), nullable=False, server_default=sa.text('1')),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index('ix_industrial_zones_district', 'industrial_zones', ['district'], unique=False)
        op.create_index('ix_industrial_zones_nearby_city', 'industrial_zones', ['nearby_city'], unique=False)
        op.create_index('ix_industrial_zones_state', 'industrial_zones', ['state'], unique=False)
        op.create_index('ix_industrial_zones_zone_grade', 'industrial_zones', ['zone_grade'], unique=False)
        op.create_index('ix_industrial_zones_zone_name', 'industrial_zones', ['zone_name'], unique=True)

    # ---- leads
    if not _has_table(insp, 'leads'):
        op.create_table(
            'leads',
            sa.Column('company_name', sa.String(255), nullable=False),
            sa.Column('business_type', sa.String(100), nullable=True),
            sa.Column('source', sa.String(100), nullable=True),
            sa.Column('contact_person', sa.String(150), nullable=True),
            sa.Column('designation', sa.String(100), nullable=True),
            sa.Column('contact_phone', sa.String(50), nullable=True),
            sa.Column('contact_email', sa.String(100), nullable=True),
            sa.Column('priority', sa.String(50), nullable=False),
            sa.Column('address', sa.String(255), nullable=True),
            sa.Column('area', sa.String(150), nullable=True),
            sa.Column('city', sa.String(100), nullable=True),
            sa.Column('district', sa.String(100), nullable=True),
            sa.Column('state', sa.String(100), nullable=True),
            sa.Column('requirements', sa.Text(), nullable=True),
            sa.Column('allotted_to', sa.String(150), nullable=True),
            sa.Column('created_by', sa.String(150), nullable=True),
            sa.Column('lead_status', sa.String(50), nullable=False),
            sa.Column('call_type', sa.String(50), nullable=True),
            sa.Column('notes', sa.Text(), nullable=True),
            sa.Column('added_on', sa.Date(), nullable=False),
            sa.Column('id', GUID(), primary_key=True),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('version', sa.Integer(), nullable=False, server_default=sa.text('1')),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index('ix_leads_allotted_to', 'leads', ['allotted_to'], unique=False)
        op.create_index('ix_leads_business_type', 'leads', ['business_type'], unique=False)
        op.create_index('ix_leads_call_type', 'leads', ['call_type'], unique=False)
        op.create_index('ix_leads_city', 'leads', ['city'], unique=False)
        op.create_index('ix_leads_company_name', 'leads', ['company_name'], unique=False)
        op.create_index('ix_leads_created_by', 'leads', ['created_by'], unique=False)
        op.create_index('ix_leads_lead_status', 'leads', ['lead_status'], unique=False)
        op.create_index('ix_leads_priority', 'leads', ['priority'], unique=False)
        op.create_index('ix_leads_source', 'leads', ['source'], unique=False)
        op.create_index('ix_leads_state', 'leads', ['state'], unique=False)

    # ---- sales_orders
    if not _has_table(insp, 'sales_orders'):
        op.create_table(
            'sales_orders',
            sa.Column('order_no', sa.String(100), nullable=False),
            sa.Column('organization_id', GUID(), nullable=True),
            sa.Column('organization_name', sa.String(150), nullable=False),
            sa.Column('buyer_id', GUID(), nullable=True),
            sa.Column('buyer_name', sa.String(200), nullable=False),
            sa.Column('buyer_branch_id', sa.String(100), nullable=True),
            sa.Column('buyer_branch_name', sa.String(150), nullable=True),
            sa.Column('company_name', sa.String(255), nullable=True),
            sa.Column('warehouse', sa.String(100), nullable=True),
            sa.Column('proforma_no', sa.String(50), nullable=True),
            sa.Column('proforma_id', GUID(), nullable=True),
            sa.Column('city', sa.String(100), nullable=True),
            sa.Column('state', sa.String(100), nullable=True),
            sa.Column('sales_person', sa.String(150), nullable=True),
            sa.Column('billing_address', sa.Text(), nullable=True),
            sa.Column('shipping_address', sa.Text(), nullable=True),
            sa.Column('payment_terms', sa.String(100), nullable=True),
            sa.Column('transport_destination', sa.String(150), nullable=True),
            sa.Column('delivery_type', sa.String(50), nullable=True),
            sa.Column('delivery_charge', sa.String(50), nullable=True),
            sa.Column('third_party_delivery', sa.String(20), nullable=True),
            sa.Column('third_party_invoice', sa.String(255), nullable=True),
            sa.Column('amount_inc_gst', sa.Float(), nullable=False, server_default=sa.text('0')),
            sa.Column('discount', sa.Float(), nullable=False, server_default=sa.text('0')),
            sa.Column('invoice_no', sa.String(100), nullable=True),
            sa.Column('invoice_date', sa.String(50), nullable=True),
            sa.Column('gatepass', sa.String(100), nullable=True),
            sa.Column('gatepass_no', sa.String(100), nullable=True),
            sa.Column('gatepass_date', sa.String(50), nullable=True),
            sa.Column('gatepass_handled_by', sa.String(150), nullable=True),
            sa.Column('consignment_code', sa.String(100), nullable=True),
            sa.Column('planning_sheet_id', GUID(), nullable=True),
            sa.Column('planning_column_id', GUID(), nullable=True),
            sa.Column('order_date', sa.String(50), nullable=False),
            sa.Column('delivery_date', sa.String(50), nullable=True),
            sa.Column('currency', sa.String(10), nullable=False),
            sa.Column('status', sa.String(30), nullable=False),
            sa.Column('total_basic', sa.Float(), nullable=False),
            sa.Column('total_tax', sa.Float(), nullable=False),
            sa.Column('total_amount', sa.Float(), nullable=False),
            sa.Column('total_quantity', sa.Float(), nullable=False),
            sa.Column('container_no', sa.String(100), nullable=True),
            sa.Column('bl_no', sa.String(100), nullable=True),
            sa.Column('lr_no', sa.String(100), nullable=True),
            sa.Column('transporter_name', sa.String(150), nullable=True),
            sa.Column('port_of_loading', sa.String(100), nullable=True),
            sa.Column('port_of_discharge', sa.String(100), nullable=True),
            sa.Column('remarks', sa.Text(), nullable=True),
            sa.Column('created_by_id', GUID(), nullable=True),
            sa.Column('created_by_name', sa.String(150), nullable=True),
            sa.Column('id', GUID(), primary_key=True),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(['organization_id'], ['master_companies.id']),
            sa.ForeignKeyConstraint(['buyer_id'], ['buyers.id']),
            sa.ForeignKeyConstraint(['planning_sheet_id'], ['planning_sheets.id']),
            sa.ForeignKeyConstraint(['planning_column_id'], ['planning_columns.id']),
            sa.ForeignKeyConstraint(['created_by_id'], ['users.id']),
        )
        op.create_index('ix_sales_orders_buyer_id', 'sales_orders', ['buyer_id'], unique=False)
        op.create_index('ix_sales_orders_company_name', 'sales_orders', ['company_name'], unique=False)
        op.create_index('ix_sales_orders_consignment_code', 'sales_orders', ['consignment_code'], unique=False)
        op.create_index('ix_sales_orders_invoice_no', 'sales_orders', ['invoice_no'], unique=False)
        op.create_index('ix_sales_orders_order_no', 'sales_orders', ['order_no'], unique=True)
        op.create_index('ix_sales_orders_organization_id', 'sales_orders', ['organization_id'], unique=False)
        op.create_index('ix_sales_orders_proforma_id', 'sales_orders', ['proforma_id'], unique=False)
        op.create_index('ix_sales_orders_proforma_no', 'sales_orders', ['proforma_no'], unique=False)
        op.create_index('ix_sales_orders_sales_person', 'sales_orders', ['sales_person'], unique=False)
        op.create_index('ix_sales_orders_status', 'sales_orders', ['status'], unique=False)
        op.create_index('ix_sales_orders_warehouse', 'sales_orders', ['warehouse'], unique=False)

    # ---- technical_task_call_logs
    if not _has_table(insp, 'technical_task_call_logs'):
        op.create_table(
            'technical_task_call_logs',
            sa.Column('task_id', GUID(), nullable=False),
            sa.Column('call_date', sa.Date(), nullable=False),
            sa.Column('call_type', sa.String(50), nullable=False),
            sa.Column('remarks', sa.Text(), nullable=False),
            sa.Column('created_by', sa.String(100), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('id', GUID(), primary_key=True),
            sa.ForeignKeyConstraint(['task_id'], ['technical_tasks.id'], ondelete='CASCADE'),
        )
        op.create_index('ix_technical_task_call_logs_task_id', 'technical_task_call_logs', ['task_id'], unique=False)

    # ---- sales_order_items
    if not _has_table(insp, 'sales_order_items'):
        op.create_table(
            'sales_order_items',
            sa.Column('order_id', GUID(), nullable=False),
            sa.Column('product_id', GUID(), nullable=True),
            sa.Column('product_name', sa.String(255), nullable=False),
            sa.Column('product_code', sa.String(100), nullable=True),
            sa.Column('hsn_code', sa.String(50), nullable=True),
            sa.Column('uom', sa.String(50), nullable=True),
            sa.Column('quantity', sa.Float(), nullable=False),
            sa.Column('unit_rate', sa.Float(), nullable=False),
            sa.Column('unit_price', sa.Float(), nullable=True),
            sa.Column('unit_discount', sa.Float(), nullable=True),
            sa.Column('taxable_amount', sa.Float(), nullable=True),
            sa.Column('tax_percent', sa.Float(), nullable=False),
            sa.Column('tax_amount', sa.Float(), nullable=False),
            sa.Column('gst_amount', sa.Float(), nullable=True),
            sa.Column('item_total', sa.Float(), nullable=False),
            sa.Column('planning_row_id', GUID(), nullable=True),
            sa.Column('remarks', sa.Text(), nullable=True),
            sa.Column('id', GUID(), primary_key=True),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(['order_id'], ['sales_orders.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['product_id'], ['products.id']),
            sa.ForeignKeyConstraint(['planning_row_id'], ['planning_rows.id']),
        )
        op.create_index('ix_sales_order_items_order_id', 'sales_order_items', ['order_id'], unique=False)
        op.create_index('ix_sales_order_items_product_id', 'sales_order_items', ['product_id'], unique=False)

    # ---- columns missing from tables that already exist
    _existing = {c['name'] for c in sa.inspect(bind).get_columns('companies')}
    if 'pincode' not in _existing:
        op.add_column('companies', sa.Column('pincode', sa.String(50), nullable=True))
    if 'company_category' not in _existing:
        op.add_column('companies', sa.Column('company_category', sa.String(150), nullable=True))
    if 'sector' not in _existing:
        op.add_column('companies', sa.Column('sector', sa.String(150), nullable=True))
    if 'product_manufacture_or_supply' not in _existing:
        op.add_column('companies', sa.Column('product_manufacture_or_supply', sa.Text(), nullable=True))
    if 'machines_buying_from' not in _existing:
        op.add_column('companies', sa.Column('machines_buying_from', sa.Text(), nullable=True))
    if 'spares_buying_from' not in _existing:
        op.add_column('companies', sa.Column('spares_buying_from', sa.Text(), nullable=True))
    if 'products_interested' not in _existing:
        op.add_column('companies', sa.Column('products_interested', sa.Text(), nullable=True))
    if 'gst_registration_date' not in _existing:
        op.add_column('companies', sa.Column('gst_registration_date', sa.String(50), nullable=True))
    if 'age_of_company' not in _existing:
        op.add_column('companies', sa.Column('age_of_company', sa.String(100), nullable=True))
    if 'social_media' not in _existing:
        op.add_column('companies', sa.Column('social_media', sa.JSON(), nullable=True))

    _existing = {c['name'] for c in sa.inspect(bind).get_columns('hrms_leave_plan_types')}
    if 'updated_at' not in _existing:
        op.add_column('hrms_leave_plan_types', sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))

    _existing = {c['name'] for c in sa.inspect(bind).get_columns('hrms_leave_adjustments')}
    if 'updated_at' not in _existing:
        op.add_column('hrms_leave_adjustments', sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))

    _existing = {c['name'] for c in sa.inspect(bind).get_columns('hrms_site_visits')}
    if 'site_latitude' not in _existing:
        op.add_column('hrms_site_visits', sa.Column('site_latitude', sa.Float(), nullable=True))
    if 'site_longitude' not in _existing:
        op.add_column('hrms_site_visits', sa.Column('site_longitude', sa.Float(), nullable=True))

    _existing = {c['name'] for c in sa.inspect(bind).get_columns('hrms_tracking_sessions')}
    if 'total_points' not in _existing:
        op.add_column('hrms_tracking_sessions', sa.Column('total_points', sa.Integer(), nullable=True))
    if 'start_latitude' not in _existing:
        op.add_column('hrms_tracking_sessions', sa.Column('start_latitude', sa.Float(), nullable=True))
    if 'start_longitude' not in _existing:
        op.add_column('hrms_tracking_sessions', sa.Column('start_longitude', sa.Float(), nullable=True))
    if 'end_latitude' not in _existing:
        op.add_column('hrms_tracking_sessions', sa.Column('end_latitude', sa.Float(), nullable=True))
    if 'end_longitude' not in _existing:
        op.add_column('hrms_tracking_sessions', sa.Column('end_longitude', sa.Float(), nullable=True))

    _existing = {c['name'] for c in sa.inspect(bind).get_columns('hrms_payroll_components')}
    if 'calculation_basis' not in _existing:
        op.add_column('hrms_payroll_components', sa.Column('calculation_basis', sa.String(50), nullable=True))

    _existing = {c['name'] for c in sa.inspect(bind).get_columns('hrms_monthly_payroll_items')}
    if 'edit_history' not in _existing:
        op.add_column('hrms_monthly_payroll_items', sa.Column('edit_history', sa.JSON(), nullable=True))

    _existing = {c['name'] for c in sa.inspect(bind).get_columns('product_stocks')}
    if 'reorder_level' not in _existing:
        op.add_column('product_stocks', sa.Column('reorder_level', sa.Float(), nullable=False, server_default=sa.text('0')))
    if 'minimum_order_quantity' not in _existing:
        op.add_column('product_stocks', sa.Column('minimum_order_quantity', sa.Float(), nullable=False, server_default=sa.text('0')))

    _existing = {c['name'] for c in sa.inspect(bind).get_columns('technical_tasks')}
    if 'third_party_city' not in _existing:
        op.add_column('technical_tasks', sa.Column('third_party_city', sa.String(100), nullable=True))
    if 'third_party_contact_name' not in _existing:
        op.add_column('technical_tasks', sa.Column('third_party_contact_name', sa.String(150), nullable=True))
    if 'third_party_contact_phone' not in _existing:
        op.add_column('technical_tasks', sa.Column('third_party_contact_phone', sa.String(50), nullable=True))
    if 'creator_remarks' not in _existing:
        op.add_column('technical_tasks', sa.Column('creator_remarks', sa.Text(), nullable=True))
    if 'payment_terms' not in _existing:
        op.add_column('technical_tasks', sa.Column('payment_terms', sa.Text(), nullable=True))
    if 'approver_remarks' not in _existing:
        op.add_column('technical_tasks', sa.Column('approver_remarks', sa.Text(), nullable=True))
    if 'scheduled_visit_date' not in _existing:
        op.add_column('technical_tasks', sa.Column('scheduled_visit_date', sa.Date(), nullable=True))
    if 'payment_mode' not in _existing:
        op.add_column('technical_tasks', sa.Column('payment_mode', sa.String(50), nullable=True))
    if 'payment_screenshot' not in _existing:
        op.add_column('technical_tasks', sa.Column('payment_screenshot', sa.String(500), nullable=True))
    if 'cancel_remarks' not in _existing:
        op.add_column('technical_tasks', sa.Column('cancel_remarks', sa.Text(), nullable=True))


def downgrade() -> None:
    # Deliberate no-op -- see the module docstring (dropping these tables could destroy live data).
    pass
