"""
Idempotent CRM QA Demo Data Seeder for Inhyma ERP.

Generates 28 realistic synthetic CRM leads across existing pipelines and stages,
with varied priorities, lifecycle statuses, follow-ups (overdue, due today, upcoming, none),
activity timelines, assignment history, duplicate phone scenarios, and role scopes:
- Admin: Unrestricted company-wide visibility (all 28 leads)
- Sales Manager: Scoped team oversight + own leads + unassigned leads (27 leads)
- Salesperson: Scoped to own assigned leads (16 leads)

Reuses existing QA user accounts:
- admin (ea2b5763-5a4d-4f21-8bff-adc3e6cb8235)
- qa_sales_manager (80c4dfb1-8d4f-4e2c-85dd-7500f035558b)
- qa_salesperson (57445d76-a405-48cb-9930-08f11fc35c4e)

Idempotent: Running multiple times updates existing QA records without creating duplicates.
"""

import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

# Add backend directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select, delete
from app.database.engine import get_sessionmaker
from app.users.models import User
from app.crm.models import (
    CrmPipeline,
    CrmPipelineStage,
    CrmLead,
    CrmFollowUp,
    CrmActivity,
    CrmAssignmentHistory,
    CrmSalespersonConfig,
)
from app.crm.lead_service import CrmLeadService

BUSINESS_TZ = ZoneInfo("Asia/Kolkata")


async def seed_qa_crm_data():
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        print("--- [1/5] Fetching existing QA Users and Roles ---")
        admin_user = (
            await session.execute(select(User).where(User.username == "admin"))
        ).scalar_one_or_none()
        mgr_user = (
            await session.execute(select(User).where(User.username == "qa_sales_manager"))
        ).scalar_one_or_none()
        rep_user = (
            await session.execute(select(User).where(User.username == "qa_salesperson"))
        ).scalar_one_or_none()

        if not admin_user or not mgr_user or not rep_user:
            raise RuntimeError(
                f"Missing QA users: admin={bool(admin_user)}, mgr={bool(mgr_user)}, rep={bool(rep_user)}"
            )

        print(f"Admin: {admin_user.username} ({admin_user.id})")
        print(f"Sales Manager: {mgr_user.username} ({mgr_user.id})")
        print(f"Salesperson: {rep_user.username} ({rep_user.id})")

        # Ensure manager relationship
        if rep_user.manager_id != mgr_user.id:
            rep_user.manager_id = mgr_user.id
            await session.flush()

        print("\n--- [2/5] Fetching Existing Pipelines & Stages ---")
        # Fetch Primary Sales pipeline
        primary_pipe = (
            await session.execute(
                select(CrmPipeline).where(CrmPipeline.is_default.is_(True), CrmPipeline.is_active.is_(True))
            )
        ).scalar_one_or_none()
        if not primary_pipe:
            primary_pipe = (
                await session.execute(
                    select(CrmPipeline).where(CrmPipeline.is_active.is_(True))
                )
            ).scalars().first()

        partner_pipe = (
            await session.execute(
                select(CrmPipeline).where(
                    CrmPipeline.name.ilike("%Partner%"),
                    CrmPipeline.is_active.is_(True),
                )
            )
        ).scalars().first()

        if not partner_pipe:
            partner_pipe = primary_pipe

        print(f"Primary Pipeline: {primary_pipe.name} ({primary_pipe.id})")
        print(f"Secondary/Partner Pipeline: {partner_pipe.name} ({partner_pipe.id})")

        # Load stages for primary pipeline
        primary_stages = (
            await session.execute(
                select(CrmPipelineStage)
                .where(CrmPipelineStage.pipeline_id == primary_pipe.id, CrmPipelineStage.is_active.is_(True))
                .order_by(CrmPipelineStage.stage_order)
            )
        ).scalars().all()

        partner_stages = (
            await session.execute(
                select(CrmPipelineStage)
                .where(CrmPipelineStage.pipeline_id == partner_pipe.id, CrmPipelineStage.is_active.is_(True))
                .order_by(CrmPipelineStage.stage_order)
            )
        ).scalars().all()

        st_map = {s.name.lower(): s for s in primary_stages}
        stage_new = st_map.get("new lead") or primary_stages[0]
        stage_qualified = st_map.get("qualified") or (primary_stages[1] if len(primary_stages) > 1 else stage_new)
        stage_won = st_map.get("closed won") or next((s for s in primary_stages if s.stage_type == "won"), stage_qualified)
        stage_lost = st_map.get("closed lost") or next((s for s in primary_stages if s.stage_type == "lost"), stage_qualified)
        stage_partner = partner_stages[0] if partner_stages else stage_new

        print(f"Mapped Stages: New='{stage_new.name}', Qualified='{stage_qualified.name}', Won='{stage_won.name}', Lost='{stage_lost.name}', Partner='{stage_partner.name}'")

        print("\n--- [3/5] Defining 28 Synthetic CRM Leads ---")
        now_utc = datetime.now(timezone.utc)
        local_now = now_utc.astimezone(BUSINESS_TZ)
        local_today = local_now.date()
        local_today_start = datetime(
            local_today.year, local_today.month, local_today.day, 0, 0, 0, tzinfo=BUSINESS_TZ
        ).astimezone(timezone.utc)

        # Lead specifications
        # (code, name, company, phone, email, campaign, source, pipeline, stage, status, priority, assignee, won_delta_days, lost_delta_days, lost_reason, follow_ups, activities)
        lead_definitions = [
            # === QA Salesperson Leads (16 leads) ===
            {
                "code": "CRM-QA-001",
                "name": "Synthetic Acme Distribution",
                "company": "Acme Distribution Corp",
                "phone": "+919000000001",
                "email": "contact@synthetic-acme.test",
                "campaign": "Q4 Enterprise Drive",
                "source": "company_campaign",
                "pipeline": primary_pipe,
                "stage": stage_new,
                "status": "new",
                "priority": "urgent",
                "assignee": rep_user,
                "follow_ups": [
                    {
                        "type": "call",
                        "due_at": local_today_start - timedelta(hours=14), # Overdue (yesterday)
                        "notes": "Overdue initial contact call regarding warehousing software",
                    }
                ],
                "activities": [
                    {"type": "call", "subject": "Introductory Call Attempt", "outcome": "No answer, left voicemail", "delta_h": -30},
                    {"type": "note", "subject": "Enterprise Requirement Note", "outcome": "Noted priority level", "delta_h": -28},
                ],
            },
            {
                "code": "CRM-QA-002",
                "name": "Synthetic Bharat Power Systems",
                "company": "Bharat Power Systems Ltd",
                "phone": "+919000000002",
                "email": "info@synthetic-bharatpower.test",
                "campaign": "Industrial Automation 2026",
                "source": "website",
                "pipeline": primary_pipe,
                "stage": stage_new,
                "status": "new",
                "priority": "high",
                "assignee": rep_user,
                "follow_ups": [
                    {
                        "type": "demo",
                        "due_at": local_today_start + timedelta(hours=14), # Due Today
                        "notes": "Live product walkthrough demonstration with engineering lead",
                    }
                ],
                "activities": [
                    {"type": "call", "subject": "Pre-demo Discovery", "outcome": "Scope confirmed", "delta_h": -10},
                ],
            },
            {
                "code": "CRM-QA-003",
                "name": "Synthetic Cosmic Logistics",
                "company": "Cosmic Freight Pvt Ltd",
                "phone": "+919000000003",
                "email": "supply@synthetic-cosmic.test",
                "campaign": "Logistics Expo India",
                "source": "referral",
                "pipeline": primary_pipe,
                "stage": stage_new,
                "status": "contacted",
                "priority": "medium",
                "assignee": rep_user,
                "follow_ups": [
                    {
                        "type": "meeting",
                        "due_at": local_today_start + timedelta(days=2, hours=11), # Upcoming
                        "notes": "Review logistics fleet tracking integration requirements",
                    }
                ],
                "activities": [
                    {"type": "call", "subject": "Referred Contact Call", "outcome": "Spoke to VP Supply Chain", "delta_h": -48},
                    {"type": "whatsapp", "subject": "Sent Product Deck", "outcome": "Deck viewed", "delta_h": -40},
                ],
            },
            {
                "code": "CRM-QA-004",
                "name": "Synthetic Delta Electronics",
                "company": "Delta Semiconductors India",
                "phone": "+919000000004",
                "email": "procure@synthetic-delta.test",
                "campaign": "Electronics Manufacturing Summit",
                "source": "inquiry",
                "pipeline": primary_pipe,
                "stage": stage_qualified,
                "status": "qualified",
                "priority": "urgent",
                "assignee": rep_user,
                "follow_ups": [
                    {
                        "type": "call",
                        "due_at": local_today_start + timedelta(hours=16), # Due Today
                        "notes": "Commercial negotiation on enterprise volume licensing",
                    }
                ],
                "activities": [
                    {"type": "meeting", "subject": "Technical Qualification Meeting", "outcome": "Architecture approved", "delta_h": -72},
                    {"type": "email", "subject": "Revised Proposal", "outcome": "Pricing delivered", "delta_h": -24},
                ],
            },
            {
                "code": "CRM-QA-005",
                "name": "Synthetic Everest Pharma Labs",
                "company": "Everest Pharmaceuticals",
                "phone": "+919000000005",
                "email": "admin@synthetic-everest.test",
                "campaign": "Healthcare Supply Chains",
                "source": "personal_lead",
                "pipeline": primary_pipe,
                "stage": stage_qualified,
                "status": "in_progress",
                "priority": "high",
                "assignee": rep_user,
                "follow_ups": [
                    {
                        "type": "meeting",
                        "due_at": local_today_start + timedelta(days=3, hours=15), # Upcoming
                        "notes": "Compliance and validation meeting for GMP standards",
                    }
                ],
                "activities": [
                    {"type": "email", "subject": "Sent FDA/GMP compliance documentation", "outcome": "Acknowledged", "delta_h": -36},
                ],
            },
            {
                "code": "CRM-QA-006",
                "name": "Synthetic Falcon Polymers",
                "company": "Falcon Polymers Ltd",
                "phone": "+919000000006",
                "email": "sales@synthetic-falconpoly.test",
                "campaign": "Chemicals & Plastics 2026",
                "source": "import",
                "pipeline": primary_pipe,
                "stage": stage_qualified,
                "status": "in_progress",
                "priority": "medium",
                "assignee": rep_user,
                "follow_ups": [
                    {
                        "type": "whatsapp",
                        "due_at": local_today_start - timedelta(days=1, hours=8), # Overdue
                        "notes": "Check client review of production scheduling sample",
                    }
                ],
                "activities": [
                    {"type": "whatsapp", "subject": "Sample Schedule Shared", "outcome": "Sent via WhatsApp", "delta_h": -50},
                ],
            },
            {
                "code": "CRM-QA-007",
                "name": "Synthetic Genesis Aerospace",
                "company": "Genesis Aerospace Technologies",
                "phone": "+919000000007",
                "email": "contact@synthetic-genesis.test",
                "campaign": "Defense & Aerospace Expo",
                "source": "company_campaign",
                "pipeline": primary_pipe,
                "stage": stage_qualified,
                "status": "qualified",
                "priority": "high",
                "assignee": rep_user,
                "follow_ups": [
                    {
                        "type": "call",
                        "due_at": local_today_start + timedelta(hours=11), # Due Today
                        "notes": "Clarify procurement terms before board sign-off",
                    }
                ],
                "activities": [
                    {"type": "call", "subject": "RFP Discussion", "outcome": "Clarified tender milestones", "delta_h": -20},
                    {"type": "note", "subject": "Security Review Passed", "outcome": "Cleared internal audit", "delta_h": -15},
                ],
            },
            {
                "code": "CRM-QA-008",
                "name": "Synthetic Horizon Infra Projects",
                "company": "Horizon Infrastructure Ltd",
                "phone": "+919000000008",
                "email": "tenders@synthetic-horizon.test",
                "campaign": "Government Tender Outreach",
                "source": "referral",
                "pipeline": primary_pipe,
                "stage": stage_new,
                "status": "contacted",
                "priority": "low",
                "assignee": rep_user,
                "follow_ups": [], # No follow-up
                "activities": [
                    {"type": "call", "subject": "Initial Intro Call", "outcome": "Prospect asked to check back next quarter", "delta_h": -90},
                ],
            },
            {
                "code": "CRM-QA-009",
                "name": "Synthetic Ion Energy Solutions",
                "company": "Ion CleanTech Pvt Ltd",
                "phone": "+919000000009",
                "email": "projects@synthetic-ionenergy.test",
                "campaign": "Renewable Energy Drive",
                "source": "website",
                "pipeline": primary_pipe,
                "stage": stage_new,
                "status": "contacted",
                "priority": "medium",
                "assignee": rep_user,
                "follow_ups": [
                    {
                        "type": "email",
                        "due_at": local_today_start + timedelta(days=5, hours=10), # Upcoming
                        "notes": "Send revised tariff calculator spreadsheet",
                    }
                ],
                "activities": [
                    {"type": "email", "subject": "Standard Brochure Email", "outcome": "Read receipt received", "delta_h": -12},
                ],
            },
            {
                "code": "CRM-QA-010",
                "name": "Synthetic Jupiter Heavy Machinery",
                "company": "Jupiter Heavy Equipments",
                "phone": "+919000000010",
                "email": "procurement@synthetic-jupiter.test",
                "campaign": "Heavy Machinery Show",
                "source": "company_campaign",
                "pipeline": primary_pipe,
                "stage": stage_won,
                "status": "won",
                "priority": "urgent",
                "assignee": rep_user,
                "won_delta_days": 5,
                "follow_ups": [],
                "activities": [
                    {"type": "meeting", "subject": "Contract Signing Dinner", "outcome": "Executed 3-year enterprise license", "delta_h": -120},
                    {"type": "note", "subject": "Account Handover", "outcome": "Transferred to Customer Success", "delta_h": -110},
                ],
            },
            {
                "code": "CRM-QA-011",
                "name": "Synthetic Kinetic Auto Components",
                "company": "Kinetic Motors Supplier Ltd",
                "phone": "+919000000011",
                "email": "contracts@synthetic-kinetic.test",
                "campaign": "Automotive Supply 2026",
                "source": "import",
                "pipeline": primary_pipe,
                "stage": stage_won,
                "status": "won",
                "priority": "high",
                "assignee": rep_user,
                "won_delta_days": 2,
                "follow_ups": [],
                "activities": [
                    {"type": "call", "subject": "PO Confirmation Call", "outcome": "PO #KNT-9082 received", "delta_h": -48},
                ],
            },
            {
                "code": "CRM-QA-012",
                "name": "Synthetic Lotus Agritech",
                "company": "Lotus Agricultural Innovations",
                "phone": "+919000000012",
                "email": "buyer@synthetic-lotusagri.test",
                "campaign": "Agritech Summit",
                "source": "personal_lead",
                "pipeline": primary_pipe,
                "stage": stage_lost,
                "status": "lost",
                "priority": "low",
                "assignee": rep_user,
                "lost_delta_days": 3,
                "lost_reason": "Budget cut by client executive board due to crop cycle delays",
                "follow_ups": [],
                "activities": [
                    {"type": "call", "subject": "Lost Notification Call", "outcome": "Confirmed budget freeze", "delta_h": -72},
                ],
            },
            {
                "code": "CRM-QA-013",
                "name": "Synthetic Marvel Textile Mills",
                "company": "Marvel Textile Group",
                "phone": "+919000000013",
                "email": "fabrics@synthetic-marveltex.test",
                "campaign": "Textile Export Drive",
                "source": "inquiry",
                "pipeline": primary_pipe,
                "stage": stage_lost,
                "status": "lost",
                "priority": "medium",
                "assignee": rep_user,
                "lost_delta_days": 1,
                "lost_reason": "Competitor offered predatory discount on legacy hardware bundling",
                "follow_ups": [],
                "activities": [
                    {"type": "email", "subject": "Lost Opportunity Debrief", "outcome": "Pricing barrier noted", "delta_h": -24},
                ],
            },
            {
                "code": "CRM-QA-014",
                "name": "Synthetic Nexus Retail Networks",
                "company": "Nexus Supermarkets Pvt Ltd",
                "phone": "+919000000014",
                "email": "pos@synthetic-nexusretail.test",
                "campaign": "Retail Chain Modernization",
                "source": "referral",
                "pipeline": partner_pipe,
                "stage": stage_partner,
                "status": "new",
                "priority": "medium",
                "assignee": rep_user,
                "follow_ups": [
                    {
                        "type": "call",
                        "due_at": local_today_start + timedelta(hours=17), # Due Today
                        "notes": "Discuss retail partner margin structure",
                    }
                ],
                "activities": [
                    {"type": "call", "subject": "Channel Alignment Call", "outcome": "Scheduled margin review", "delta_h": -6},
                ],
            },
            {
                "code": "CRM-QA-015",
                "name": "Synthetic Orbit Telecommunications",
                "company": "Orbit Telecom Infra",
                "phone": "+919000000015",
                "email": "infra@synthetic-orbittele.test",
                "campaign": "5G Rollout Partners",
                "source": "company_campaign",
                "pipeline": partner_pipe,
                "stage": stage_partner,
                "status": "contacted",
                "priority": "high",
                "assignee": rep_user,
                "follow_ups": [
                    {
                        "type": "meeting",
                        "due_at": local_today_start + timedelta(days=2, hours=14), # Upcoming
                        "notes": "Channel partner SLA draft discussion",
                    }
                ],
                "activities": [
                    {"type": "meeting", "subject": "Partner Discovery Session", "outcome": "Identified 4 regional zones", "delta_h": -30},
                ],
            },
            {
                "code": "CRM-QA-028",
                "name": "Synthetic Vertex Cloud Robotics",
                "company": "Vertex Robotics Automation",
                "phone": "+919000000028",
                "email": "tech@synthetic-vertexrobot.test",
                "campaign": "Industrial Automation 2026",
                "source": "referral",
                "pipeline": partner_pipe,
                "stage": stage_partner,
                "status": "contacted",
                "priority": "urgent",
                "assignee": rep_user,
                "follow_ups": [
                    {
                        "type": "whatsapp",
                        "due_at": local_today_start + timedelta(hours=15), # Due Today
                        "notes": "Urgent WhatsApp confirmation of robotics API specs",
                    }
                ],
                "activities": [
                    {"type": "whatsapp", "subject": "API Spec Sent", "outcome": "Delivered to Tech Director", "delta_h": -8},
                ],
            },

            # === QA Sales Manager Direct Leads (7 leads) ===
            {
                "code": "CRM-QA-016",
                "name": "Synthetic Pioneer Metals Corp",
                "company": "Pioneer Alloys Ltd",
                "phone": "+919000000016",
                "email": "procure@synthetic-pioneer.test",
                "campaign": "Q4 Enterprise Drive",
                "source": "company_campaign",
                "pipeline": primary_pipe,
                "stage": stage_new,
                "status": "new",
                "priority": "urgent",
                "assignee": mgr_user,
                "follow_ups": [
                    {
                        "type": "call",
                        "due_at": local_today_start + timedelta(hours=12), # Due Today
                        "notes": "Executive sponsor alignment call with Managing Director",
                    }
                ],
                "activities": [
                    {"type": "call", "subject": "Executive Introduction", "outcome": "Agreed to review proposal", "delta_h": -14},
                    {"type": "note", "subject": "Key Account Notes", "outcome": "Target close end of month", "delta_h": -10},
                ],
            },
            {
                "code": "CRM-QA-017",
                "name": "Synthetic Quantum Cold Storage",
                "company": "Quantum Logistics Hub",
                "phone": "+919000000017",
                "email": "coldchain@synthetic-quantum.test",
                "campaign": "Logistics Expo India",
                "source": "website",
                "pipeline": primary_pipe,
                "stage": stage_qualified,
                "status": "in_progress",
                "priority": "high",
                "assignee": mgr_user,
                "follow_ups": [
                    {
                        "type": "meeting",
                        "due_at": local_today_start - timedelta(hours=18), # Overdue
                        "notes": "Overdue managerial review of master service agreement",
                    }
                ],
                "activities": [
                    {"type": "meeting", "subject": "Managerial Strategy Meeting", "outcome": "Terms negotiated", "delta_h": -40},
                ],
            },
            {
                "code": "CRM-QA-018",
                "name": "Synthetic Radiant Solar Parks",
                "company": "Radiant Solar Generation Ltd",
                "phone": "+919000000018",
                "email": "cleanpower@synthetic-radiant.test",
                "campaign": "Renewable Energy Drive",
                "source": "referral",
                "pipeline": primary_pipe,
                "stage": stage_qualified,
                "status": "qualified",
                "priority": "medium",
                "assignee": mgr_user,
                "follow_ups": [
                    {
                        "type": "call",
                        "due_at": local_today_start + timedelta(days=4, hours=10), # Upcoming
                        "notes": "Project financing verification call",
                    }
                ],
                "activities": [
                    {"type": "call", "subject": "Financing Check", "outcome": "Bank approval in progress", "delta_h": -24},
                ],
            },
            {
                "code": "CRM-QA-019",
                "name": "Synthetic Stellar Engineering",
                "company": "Stellar Heavy Engg Works",
                "phone": "+919000000019",
                "email": "orders@synthetic-stellar.test",
                "campaign": "Industrial Automation 2026",
                "source": "inquiry",
                "pipeline": primary_pipe,
                "stage": stage_won,
                "status": "won",
                "priority": "urgent",
                "assignee": mgr_user,
                "won_delta_days": 4,
                "follow_ups": [],
                "activities": [
                    {"type": "meeting", "subject": "Executive Handshake", "outcome": "Deal closed for $120k ARR", "delta_h": -96},
                ],
            },
            {
                "code": "CRM-QA-020",
                "name": "Synthetic Titan Defense Solutions",
                "company": "Titan Defense Systems",
                "phone": "+919000000020",
                "email": "security@synthetic-titandef.test",
                "campaign": "Defense & Aerospace Expo",
                "source": "company_campaign",
                "pipeline": partner_pipe,
                "stage": stage_partner,
                "status": "qualified",
                "priority": "high",
                "assignee": mgr_user,
                "follow_ups": [
                    {
                        "type": "demo",
                        "due_at": local_today_start + timedelta(days=1, hours=15), # Upcoming
                        "notes": "Partner technical capabilities demonstration",
                    }
                ],
                "activities": [
                    {"type": "email", "subject": "Partner Deck Delivered", "outcome": "Confirmed interest", "delta_h": -20},
                ],
            },
            {
                "code": "CRM-QA-025",
                "name": "Synthetic Dynamic Paper Mills (Inbound)",
                "company": "Dynamic Paper Mills Pvt Ltd",
                "phone": "+919000000099", # Shared duplicate phone
                "email": "order1@synthetic-dynamicpaper.test",
                "campaign": "Print & Packaging 2026",
                "source": "website",
                "pipeline": primary_pipe,
                "stage": stage_new,
                "status": "new",
                "priority": "medium",
                "assignee": mgr_user,
                "follow_ups": [],
                "activities": [
                    {"type": "note", "subject": "Inbound Web Inquiry", "outcome": "Client requested bulk catalog", "delta_h": -10},
                ],
            },
            {
                "code": "CRM-QA-027",
                "name": "Synthetic Echo Diagnostic Centers",
                "company": "Echo Healthcare Diagnostics",
                "phone": "+919000000027",
                "email": "lab@synthetic-echodiag.test",
                "campaign": "Healthcare Supply Chains",
                "source": "company_campaign",
                "pipeline": primary_pipe,
                "stage": stage_lost,
                "status": "lost",
                "priority": "high",
                "assignee": mgr_user,
                "lost_delta_days": 6,
                "lost_reason": "Client decided to build an internal custom tool on open source",
                "follow_ups": [],
                "activities": [
                    {"type": "meeting", "subject": "Debrief with CTO", "outcome": "Documented in-house decision", "delta_h": -144},
                ],
            },

            # === Duplicate Phone Scenario Lead (Assigned to Rep) ===
            {
                "code": "CRM-QA-026",
                "name": "Synthetic Dynamic Paper Mills (Trade Show)",
                "company": "Dynamic Paper Mills Pvt Ltd",
                "phone": "+919000000099", # Shared duplicate phone with CRM-QA-025!
                "email": "order2@synthetic-dynamicpaper.test",
                "campaign": "Industrial Automation 2026",
                "source": "import",
                "pipeline": primary_pipe,
                "stage": stage_new,
                "status": "contacted",
                "priority": "high",
                "assignee": rep_user,
                "follow_ups": [],
                "activities": [
                    {"type": "call", "subject": "Trade Show Booth Badge Scan", "outcome": "Met purchasing director", "delta_h": -18},
                ],
            },

            # === Unassigned Leads (4 leads - visible to Manager for Team Oversight & Admin) ===
            {
                "code": "CRM-QA-021",
                "name": "Synthetic Zenith Chemicals",
                "company": "Zenith Chemical Works",
                "phone": "+919000000021",
                "email": "inquiry@synthetic-zenithchem.test",
                "campaign": "Chemicals & Plastics 2026",
                "source": "website",
                "pipeline": primary_pipe,
                "stage": stage_new,
                "status": "new",
                "priority": "medium",
                "assignee": None,
                "follow_ups": [],
                "activities": [
                    {"type": "note", "subject": "Raw Website Inquiry", "outcome": "Pending distribution", "delta_h": -5},
                ],
            },
            {
                "code": "CRM-QA-022",
                "name": "Synthetic Alpha Pack Innovations",
                "company": "Alpha Packaging Solutions",
                "phone": "+919000000022",
                "email": "sales@synthetic-alphapack.test",
                "campaign": "Retail Chain Modernization",
                "source": "import",
                "pipeline": primary_pipe,
                "stage": stage_new,
                "status": "new",
                "priority": "low",
                "assignee": None,
                "follow_ups": [],
                "activities": [],
            },
            {
                "code": "CRM-QA-023",
                "name": "Synthetic Blue Ocean Marine",
                "company": "Blue Ocean Shipping Ltd",
                "phone": "+919000000023",
                "email": "cargo@synthetic-blueocean.test",
                "campaign": "Logistics Expo India",
                "source": "inquiry",
                "pipeline": primary_pipe,
                "stage": stage_new,
                "status": "new",
                "priority": "high",
                "assignee": None,
                "follow_ups": [],
                "activities": [],
            },
            {
                "code": "CRM-QA-024",
                "name": "Synthetic Cedar Wood & Furniture",
                "company": "Cedar Modular Furnishings",
                "phone": "+919000000024",
                "email": "info@synthetic-cedarwood.test",
                "campaign": "Commercial Interiors 2026",
                "source": "website",
                "pipeline": partner_pipe,
                "stage": stage_partner,
                "status": "new",
                "priority": "medium",
                "assignee": None,
                "follow_ups": [],
                "activities": [],
            },
        ]

        print(f"Total leads to seed/update: {len(lead_definitions)}")

        print("\n--- [4/5] Executing Idempotent Seed Procedure ---")
        created_count = 0
        updated_count = 0
        all_seeded_leads = []

        crm_service = CrmLeadService(session=session)

        for d in lead_definitions:
            # Check for existing lead by lead_code OR external_record_id
            existing_lead = (
                await session.execute(
                    select(CrmLead).where(
                        (CrmLead.lead_code == d["code"])
                        | (
                            (CrmLead.external_source_system == "QA_SEED_DEMO")
                            & (CrmLead.external_record_id == d["code"])
                        )
                    )
                )
            ).scalar_one_or_none()

            won_time = now_utc - timedelta(days=d["won_delta_days"]) if "won_delta_days" in d else None
            lost_time = now_utc - timedelta(days=d["lost_delta_days"]) if "lost_delta_days" in d else None

            assignee_id = d["assignee"].id if d["assignee"] else None

            if existing_lead:
                # Update existing lead
                existing_lead.name = d["name"]
                existing_lead.company_name = d["company"]
                existing_lead.original_phone = d["phone"]
                existing_lead.normalized_phone = d["phone"]
                existing_lead.email = d["email"]
                existing_lead.campaign = d["campaign"]
                existing_lead.source_type = d["source"]
                existing_lead.pipeline_id = d["pipeline"].id
                existing_lead.stage_id = d["stage"].id
                existing_lead.status = d["status"]
                existing_lead.priority = d["priority"]
                existing_lead.assigned_to = assignee_id
                existing_lead.won_at = won_time
                existing_lead.lost_at = lost_time
                existing_lead.lost_reason = d.get("lost_reason")
                existing_lead.external_source_system = "QA_SEED_DEMO"
                existing_lead.external_record_id = d["code"]
                existing_lead.deleted_at = None
                lead_obj = existing_lead
                updated_count += 1
            else:
                lead_obj = CrmLead(
                    lead_code=d["code"],
                    name=d["name"],
                    company_name=d["company"],
                    original_phone=d["phone"],
                    normalized_phone=d["phone"],
                    email=d["email"],
                    campaign=d["campaign"],
                    source_type=d["source"],
                    pipeline_id=d["pipeline"].id,
                    stage_id=d["stage"].id,
                    status=d["status"],
                    priority=d["priority"],
                    assigned_to=assignee_id,
                    won_at=won_time,
                    lost_at=lost_time,
                    lost_reason=d.get("lost_reason"),
                    external_source_system="QA_SEED_DEMO",
                    external_record_id=d["code"],
                    created_by=admin_user.id,
                )
                session.add(lead_obj)
                await session.flush()
                created_count += 1

            all_seeded_leads.append(lead_obj)

            # Clean and re-seed follow-ups and activities idempotently for this lead
            await session.execute(
                delete(CrmFollowUp).where(CrmFollowUp.lead_id == lead_obj.id)
            )
            await session.execute(
                delete(CrmActivity).where(CrmActivity.lead_id == lead_obj.id)
            )
            await session.execute(
                delete(CrmAssignmentHistory).where(CrmAssignmentHistory.lead_id == lead_obj.id)
            )

            # Insert follow-ups
            for fu in d.get("follow_ups", []):
                new_fu = CrmFollowUp(
                    lead_id=lead_obj.id,
                    assigned_to=assignee_id,
                    created_by=admin_user.id if not assignee_id else (mgr_user.id if assignee_id == rep_user.id else admin_user.id),
                    follow_up_type=fu["type"],
                    due_at=fu["due_at"],
                    status="pending",
                    notes=fu["notes"],
                )
                session.add(new_fu)

            # Insert activities
            for act in d.get("activities", []):
                act_time = now_utc + timedelta(hours=act["delta_h"])
                new_act = CrmActivity(
                    lead_id=lead_obj.id,
                    activity_type=act["type"],
                    subject=act["subject"],
                    description=f"Synthetic touchpoint description for {lead_obj.name}",
                    outcome=act["outcome"],
                    performed_by=assignee_id or admin_user.id,
                    activity_at=act_time,
                    created_at=act_time,
                )
                session.add(new_act)

            # Insert assignment history
            if assignee_id:
                assign_hist = CrmAssignmentHistory(
                    lead_id=lead_obj.id,
                    previous_owner_id=None,
                    new_owner_id=assignee_id,
                    assignment_method="qa_seeder_assignment",
                    assigned_by=mgr_user.id if assignee_id == rep_user.id else admin_user.id,
                    reason="Initial QA team assignment",
                    created_at=now_utc - timedelta(days=2),
                )
                session.add(assign_hist)

            await session.flush()
            # Recalculate next_follow_up_at
            await crm_service._recalculate_next_follow_up(lead_obj)

        await session.commit()
        print(f"Seeding completed: {created_count} created, {updated_count} updated. Total active QA leads: {len(all_seeded_leads)}")

        print("\n--- [5/5] Verification of Seeded Data ---")
        total_leads_in_db = (await session.execute(select(CrmLead).where(CrmLead.deleted_at.is_(None)))).scalars().all()
        print(f"Total leads currently in database: {len(total_leads_in_db)}")

        rep_leads = [l for l in total_leads_in_db if l.assigned_to == rep_user.id]
        mgr_leads = [l for l in total_leads_in_db if l.assigned_to == mgr_user.id]
        unassigned_leads = [l for l in total_leads_in_db if l.assigned_to is None]

        print(f"  Salesperson leads: {len(rep_leads)}")
        print(f"  Sales Manager direct leads: {len(mgr_leads)}")
        print(f"  Unassigned leads: {len(unassigned_leads)}")

        # Follow-up stats for salesperson
        rep_fus = (
            await session.execute(
                select(CrmFollowUp).where(
                    CrmFollowUp.assigned_to == rep_user.id,
                    CrmFollowUp.deleted_at.is_(None),
                )
            )
        ).scalars().all()
        print(f"  Total follow-ups for Salesperson: {len(rep_fus)}")


if __name__ == "__main__":
    asyncio.run(seed_qa_crm_data())
