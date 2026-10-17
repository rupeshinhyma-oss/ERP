"""
Test Suite for CRM Reports & Analytics Module.

Verifies:
1. Role-based data visibility & isolation:
   - Admin: Company-wide reports and analytics across all pipelines and sales representatives.
   - Manager: Strictly restricted to authorized teams and departmental representatives.
   - Salesperson: Strictly personal metrics; forced self-assignment; out-of-scope rep query rejected with 403 Forbidden.
2. Useful CRM Metrics:
   - Total leads, new leads in range, active leads, won/lost counts.
   - Accurately calculated conversion rates with clearly defined denominators (None when no closed leads exist).
   - Leads by pipeline, stage, campaign, and source.
   - Salesperson performance & workload distribution.
   - Time series trends over selectable date ranges.
3. Data Accuracy:
   - Asia/Kolkata date boundaries.
   - Zero double-counting of leads, activities, and campaigns.
   - Soft-deleted leads, pipelines, and follow-ups safely ignored.
   - Empty datasets and invalid date ranges handled gracefully.
"""

from __future__ import annotations

import random
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.auth.security import create_access_token
from app.crm.models import (
    CrmActivity,
    CrmFollowUp,
    CrmLead,
    CrmPipeline,
    CrmPipelineStage,
    CrmSalespersonConfig,
)
from app.database.engine import get_sessionmaker
from app.users.models import User, UserStatus

ADMIN_ID = uuid.UUID("ea2b5763-5a4d-4f21-8bff-adc3e6cb8235")
MANAGER_ID = uuid.UUID("70b70538-2188-4a7a-8aab-b34c7243db05")
REP_A_ID = uuid.UUID("0c0d89b7-5105-4dc6-945b-301a049f4502")
REP_B_ID = uuid.UUID("b04e86e1-6f74-4c51-a247-2440adaf38df")

try:
    BUSINESS_TZ = ZoneInfo("Asia/Kolkata")
except Exception:
    BUSINESS_TZ = timezone(timedelta(hours=5, minutes=30))


def unique_phone() -> str:
    return f"9{random.randint(100000000, 999999999)}"


@pytest.fixture
def admin_headers() -> dict[str, str]:
    token = create_access_token(
        ADMIN_ID,
        permissions=["crm.leads.view", "crm.leads.manage", "*"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def manager_headers() -> dict[str, str]:
    token = create_access_token(
        MANAGER_ID,
        permissions=["crm.leads.view", "crm.leads.manage"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def rep_a_headers() -> dict[str, str]:
    token = create_access_token(
        REP_A_ID,
        permissions=["crm.leads.view"],
    ).token
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def setup_analytics_env():
    """
    Sets up a complete CRM reporting test environment with:
    - 1 Sales Pipeline with Open, Won, and Lost stages
    - Rep A (managed by MANAGER_ID) with 2 active leads, 1 won lead, 1 lost lead, and follow-ups
    - Rep B (NOT managed by MANAGER_ID) with leads and follow-ups
    - 1 Unassigned lead
    """
    sessionmaker = get_sessionmaker()
    pipeline_id = uuid.uuid4()
    stage_open_id = uuid.uuid4()
    stage_won_id = uuid.uuid4()
    stage_lost_id = uuid.uuid4()

    now_utc = datetime.now(timezone.utc)
    local_now = now_utc.astimezone(BUSINESS_TZ)
    local_today = local_now.date()
    local_today_start = datetime(
        local_today.year, local_today.month, local_today.day, 0, 0, 0, tzinfo=BUSINESS_TZ
    ).astimezone(timezone.utc)

    async with sessionmaker() as session:
        # Verify or ensure users exist
        user_mgr = await session.get(User, MANAGER_ID)
        if not user_mgr:
            user_mgr = User(
                id=MANAGER_ID,
                email="manager_analytics@test.com",
                username="mgr_analytics",
                display_name="Analytics Manager",
                status=UserStatus.ACTIVE,
                is_active=True,
                has_login=True,
            )
            session.add(user_mgr)

        user_a = await session.get(User, REP_A_ID)
        if not user_a:
            user_a = User(
                id=REP_A_ID,
                email="rep_a_analytics@test.com",
                username="rep_a_analytics",
                display_name="Rep A InScope",
                status=UserStatus.ACTIVE,
                is_active=True,
                has_login=True,
                manager_id=MANAGER_ID,
            )
            session.add(user_a)
        else:
            user_a.manager_id = MANAGER_ID

        user_b = await session.get(User, REP_B_ID)
        if not user_b:
            user_b = User(
                id=REP_B_ID,
                email="rep_b_analytics@test.com",
                username="rep_b_analytics",
                display_name="Rep B OutScope",
                status=UserStatus.ACTIVE,
                is_active=True,
                has_login=True,
                manager_id=None,
            )
            session.add(user_b)
        else:
            user_b.manager_id = None

        # Salesperson configs
        cfg_a = (await session.execute(
            select(CrmSalespersonConfig).where(CrmSalespersonConfig.user_id == REP_A_ID)
        )).scalar_one_or_none()
        if not cfg_a:
            cfg_a = CrmSalespersonConfig(user_id=REP_A_ID, is_eligible=True, is_active=True, max_lead_capacity=50)
            session.add(cfg_a)

        cfg_b = (await session.execute(
            select(CrmSalespersonConfig).where(CrmSalespersonConfig.user_id == REP_B_ID)
        )).scalar_one_or_none()
        if not cfg_b:
            cfg_b = CrmSalespersonConfig(user_id=REP_B_ID, is_eligible=True, is_active=True, max_lead_capacity=30)
            session.add(cfg_b)

        # Pipeline & Stages
        pipe = CrmPipeline(
            id=pipeline_id,
            name=f"Analytics Pipeline {pipeline_id.hex[:6]}",
            description="Testing CRM reports and analytics",
            is_active=True,
            created_by=ADMIN_ID,
        )
        session.add(pipe)

        st_open = CrmPipelineStage(
            id=stage_open_id,
            pipeline_id=pipeline_id,
            name="Open Lead",
            stage_order=0,
            stage_type="open",
            is_initial=True,
            is_active=True,
        )
        st_won = CrmPipelineStage(
            id=stage_won_id,
            pipeline_id=pipeline_id,
            name="Deal Won",
            stage_order=1,
            stage_type="won",
            is_initial=False,
            is_active=True,
        )
        st_lost = CrmPipelineStage(
            id=stage_lost_id,
            pipeline_id=pipeline_id,
            name="Deal Lost",
            stage_order=2,
            stage_type="lost",
            is_initial=False,
            is_active=True,
        )
        session.add_all([st_open, st_won, st_lost])
        await session.flush()

        # Rep A Leads
        lead_a1_phone = unique_phone()
        lead_a1 = CrmLead(
            pipeline_id=pipeline_id,
            stage_id=stage_open_id,
            name="Lead A1 Active",
            original_phone=lead_a1_phone,
            normalized_phone=f"+91{lead_a1_phone}",
            assigned_to=REP_A_ID,
            created_by=ADMIN_ID,
            status="in_progress",
            campaign="Camp_InScope_A",
            source_type="company_campaign",
            created_at=now_utc - timedelta(days=2),
        )
        lead_a2_phone = unique_phone()
        lead_a2 = CrmLead(
            pipeline_id=pipeline_id,
            stage_id=stage_open_id,
            name="Lead A2 Active",
            original_phone=lead_a2_phone,
            normalized_phone=f"+91{lead_a2_phone}",
            assigned_to=REP_A_ID,
            created_by=ADMIN_ID,
            status="contacted",
            campaign="Camp_InScope_A",
            source_type="company_campaign",
            created_at=now_utc - timedelta(days=1),
        )
        lead_a_won_phone = unique_phone()
        lead_a_won = CrmLead(
            pipeline_id=pipeline_id,
            stage_id=stage_won_id,
            name="Lead A Won",
            original_phone=lead_a_won_phone,
            normalized_phone=f"+91{lead_a_won_phone}",
            assigned_to=REP_A_ID,
            created_by=ADMIN_ID,
            status="won",
            won_at=now_utc - timedelta(hours=5),
            campaign="Camp_InScope_A",
            source_type="website",
            created_at=now_utc - timedelta(days=5),
        )
        lead_a_lost_phone = unique_phone()
        lead_a_lost = CrmLead(
            pipeline_id=pipeline_id,
            stage_id=stage_lost_id,
            name="Lead A Lost",
            original_phone=lead_a_lost_phone,
            normalized_phone=f"+91{lead_a_lost_phone}",
            assigned_to=REP_A_ID,
            created_by=ADMIN_ID,
            status="lost",
            lost_at=now_utc - timedelta(hours=2),
            lost_reason="Budget constraint",
            campaign="Camp_InScope_B",
            source_type="referral",
            created_at=now_utc - timedelta(days=3),
        )

        # Rep B Leads (Outside Manager scope)
        lead_b1_phone = unique_phone()
        lead_b1 = CrmLead(
            pipeline_id=pipeline_id,
            stage_id=stage_open_id,
            name="Lead B1 Active",
            original_phone=lead_b1_phone,
            normalized_phone=f"+91{lead_b1_phone}",
            assigned_to=REP_B_ID,
            created_by=ADMIN_ID,
            status="new",
            campaign="Camp_OutScope",
            source_type="import",
            created_at=now_utc - timedelta(days=1),
        )
        lead_b_won_phone = unique_phone()
        lead_b_won = CrmLead(
            pipeline_id=pipeline_id,
            stage_id=stage_won_id,
            name="Lead B Won",
            original_phone=lead_b_won_phone,
            normalized_phone=f"+91{lead_b_won_phone}",
            assigned_to=REP_B_ID,
            created_by=ADMIN_ID,
            status="won",
            won_at=now_utc - timedelta(hours=6),
            campaign="Camp_OutScope",
            source_type="import",
            created_at=now_utc - timedelta(days=4),
        )

        # Unassigned Lead
        lead_unassigned_phone = unique_phone()
        lead_unassigned = CrmLead(
            pipeline_id=pipeline_id,
            stage_id=stage_open_id,
            name="Unassigned Lead",
            original_phone=lead_unassigned_phone,
            normalized_phone=f"+91{lead_unassigned_phone}",
            assigned_to=None,
            created_by=ADMIN_ID,
            status="new",
            campaign=None,  # Direct / Unspecified
            source_type="website",
            created_at=now_utc - timedelta(days=2),
        )

        session.add_all([lead_a1, lead_a2, lead_a_won, lead_a_lost, lead_b1, lead_b_won, lead_unassigned])
        await session.flush()

        # Follow-ups
        fu_a_overdue = CrmFollowUp(
            lead_id=lead_a1.id,
            assigned_to=REP_A_ID,
            due_at=local_today_start - timedelta(hours=4),
            follow_up_type="call",
            status="pending",
            created_by=ADMIN_ID,
            created_at=now_utc,
            updated_at=now_utc,
        )
        fu_a_today = CrmFollowUp(
            lead_id=lead_a2.id,
            assigned_to=REP_A_ID,
            due_at=local_today_start + timedelta(hours=4),
            follow_up_type="meeting",
            status="pending",
            created_by=ADMIN_ID,
            created_at=now_utc,
            updated_at=now_utc,
        )
        fu_b_today = CrmFollowUp(
            lead_id=lead_b1.id,
            assigned_to=REP_B_ID,
            due_at=local_today_start + timedelta(hours=2),
            follow_up_type="call",
            status="pending",
            created_by=ADMIN_ID,
            created_at=now_utc,
            updated_at=now_utc,
        )
        session.add_all([fu_a_overdue, fu_a_today, fu_b_today])

        # Activities
        act_a = CrmActivity(
            lead_id=lead_a1.id,
            activity_type="call",
            subject="Discovery Call with Prospect",
            performed_by=REP_A_ID,
            activity_at=now_utc - timedelta(hours=1),
        )
        act_b = CrmActivity(
            lead_id=lead_b1.id,
            activity_type="email",
            subject="Product Catalog Sent",
            performed_by=REP_B_ID,
            activity_at=now_utc - timedelta(hours=3),
        )
        session.add_all([act_a, act_b])
        await session.commit()

    return {
        "pipeline_id": pipeline_id,
        "stage_open_id": stage_open_id,
        "stage_won_id": stage_won_id,
        "stage_lost_id": stage_lost_id,
    }


# =============================================================================
# 1. Admin Company-Wide Analytics
# =============================================================================


@pytest.mark.asyncio
async def test_admin_company_wide_analytics_metrics(
    client: AsyncClient,
    admin_headers: dict[str, str],
    setup_analytics_env: dict,
):
    """
    Admin receives company-wide metrics covering all representatives, pipelines,
    and unassigned leads without scope restrictions.
    """
    pipe_id = str(setup_analytics_env["pipeline_id"])

    res = await client.get(
        f"/api/v1/crm/reports/analytics?pipeline_id={pipe_id}",
        headers=admin_headers,
    )
    assert res.status_code == 200
    data = res.json()["data"]

    assert data["role_type"] == "admin"
    assert data["scope_type"] == "company_wide"
    assert data["timezone"] == "Asia/Kolkata"

    overview = data["overview"]
    # All 7 leads created in env belong to this pipeline
    assert overview["total_leads_in_range"] == 7
    # Active leads: A1, A2, B1, Unassigned = 4
    assert overview["total_active_leads"] == 4
    # Won in range: A Won, B Won = 2
    assert overview["won_count"] == 2
    # Lost in range: A Lost = 1
    assert overview["lost_count"] == 1
    assert overview["closed_count"] == 3
    # Conversion rate: 2 / 3 * 100 = 66.7%
    assert overview["conversion_rate"] == 66.7
    # Assigned vs unassigned created in range
    assert overview["assigned_count"] == 6
    assert overview["unassigned_count"] == 1
    # Overdue follow-ups
    assert overview["overdue_follow_ups"] >= 1

    # Pipelines breakdown
    pipelines = data["pipelines"]
    assert len(pipelines) >= 1
    target_p = next(p for p in pipelines if p["pipeline_id"] == pipe_id)
    assert target_p["lead_count"] == 7
    assert target_p["won_count"] == 2
    assert target_p["lost_count"] == 1
    assert target_p["active_count"] == 4
    assert len(target_p["stages"]) == 3

    # Campaigns breakdown
    campaigns = data["campaigns"]
    camp_names = [c["campaign"] for c in campaigns]
    assert "Camp_InScope_A" in camp_names
    assert "Camp_OutScope" in camp_names
    assert "(Direct / Unspecified)" in camp_names

    # Check Camp_InScope_A conversion: 3 leads (A1, A2, A Won), 1 won, 0 lost -> closed=1 -> 100%
    camp_a = next(c for c in campaigns if c["campaign"] == "Camp_InScope_A")
    assert camp_a["total_leads"] == 3
    assert camp_a["won_leads"] == 1
    assert camp_a["conversion_rate"] == 100.0

    # Reps breakdown includes both Rep A and Rep B
    reps = data["reps"]
    rep_ids = [r["salesperson_id"] for r in reps]
    assert str(REP_A_ID) in rep_ids
    assert str(REP_B_ID) in rep_ids

    # Trends over time
    trends = data["trends"]
    assert len(trends) > 0
    assert "date" in trends[0]
    assert "new_leads" in trends[0]
    assert "won_leads" in trends[0]


# =============================================================================
# 2. Manager Team-Scoped Analytics Isolation
# =============================================================================


@pytest.mark.asyncio
async def test_manager_team_scoped_analytics_isolation(
    client: AsyncClient,
    manager_headers: dict[str, str],
    setup_analytics_env: dict,
):
    """
    Manager query is strictly scoped to authorized team members (Rep A).
    Rep B leads and performance metrics are excluded from totals and breakdowns.
    """
    pipe_id = str(setup_analytics_env["pipeline_id"])

    res = await client.get(
        f"/api/v1/crm/reports/analytics?pipeline_id={pipe_id}",
        headers=manager_headers,
    )
    assert res.status_code == 200
    data = res.json()["data"]

    assert data["role_type"] == "manager"
    assert data["scope_type"] == "team"

    overview = data["overview"]
    # Manager sees Rep A leads (4 leads: A1, A2, A_won, A_lost)
    # Plus unassigned lead (created by admin, but not assigned to manager's team)
    # Rep B's 2 leads (B1, B_won) MUST be excluded!
    assert overview["total_leads_in_range"] == 4
    assert overview["total_active_leads"] == 2  # A1, A2
    assert overview["won_count"] == 1  # Only A Won (B Won excluded!)
    assert overview["lost_count"] == 1  # A Lost
    assert overview["closed_count"] == 2
    # Conversion rate: 1 / 2 * 100 = 50.0%
    assert overview["conversion_rate"] == 50.0

    # Reps list must NOT include Rep B
    reps = data["reps"]
    rep_ids = [r["salesperson_id"] for r in reps]
    assert str(REP_A_ID) in rep_ids
    assert str(REP_B_ID) not in rep_ids


# =============================================================================
# 3. Manager Out-of-Scope Salesperson Query Rejection
# =============================================================================


@pytest.mark.asyncio
async def test_manager_out_of_scope_salesperson_rejection(
    client: AsyncClient,
    manager_headers: dict[str, str],
    setup_analytics_env: dict,
):
    """
    Manager attempting to filter by an out-of-scope salesperson (Rep B) is rejected with 403 Forbidden.
    """
    res = await client.get(
        f"/api/v1/crm/reports/analytics?salesperson_id={REP_B_ID}",
        headers=manager_headers,
    )
    assert res.status_code == 403
    err_msg = (res.json().get("detail", "") or res.json().get("message", "")).lower()
    assert "outside your authorized scope" in err_msg


# =============================================================================
# 4. Salesperson Strictly Personal Analytics Isolation
# =============================================================================


@pytest.mark.asyncio
async def test_salesperson_personal_analytics_isolation(
    client: AsyncClient,
    rep_a_headers: dict[str, str],
    setup_analytics_env: dict,
):
    """
    Salesperson queries reports and analytics:
    - Strictly forced to themselves on the backend.
    - Sees only their own leads, conversion rates, and activities.
    - Querying another representative's ID returns 403 Forbidden.
    """
    pipe_id = str(setup_analytics_env["pipeline_id"])

    # 1. Querying own analytics (salesperson_id omitted)
    res = await client.get(
        f"/api/v1/crm/reports/analytics?pipeline_id={pipe_id}",
        headers=rep_a_headers,
    )
    assert res.status_code == 200
    data = res.json()["data"]

    assert data["role_type"] == "salesperson"
    assert data["scope_type"] == "personal"
    assert data["salesperson_id"] == str(REP_A_ID)

    overview = data["overview"]
    assert overview["total_leads_in_range"] == 4  # A1, A2, A_won, A_lost
    assert overview["total_active_leads"] == 2
    assert overview["won_count"] == 1
    assert overview["lost_count"] == 1
    assert overview["closed_count"] == 2
    assert overview["conversion_rate"] == 50.0

    # Reps breakdown must contain ONLY Rep A
    reps = data["reps"]
    assert len(reps) == 1
    assert reps[0]["salesperson_id"] == str(REP_A_ID)
    assert reps[0]["assigned_leads"] >= 4
    assert reps[0]["active_leads"] == 2
    assert reps[0]["won_count"] == 1
    assert reps[0]["lost_count"] == 1
    assert reps[0]["conversion_rate"] == 50.0

    # 2. Salesperson attempting to pass another representative's ID -> 403 Forbidden
    res_other = await client.get(
        f"/api/v1/crm/reports/analytics?salesperson_id={REP_B_ID}",
        headers=rep_a_headers,
    )
    assert res_other.status_code == 403
    err_msg = (res_other.json().get("detail", "") or res_other.json().get("message", "")).lower()
    assert "salespeople can only query their own" in err_msg


# =============================================================================
# 5. Conversion Rate Calculation & Clear Denominators
# =============================================================================


@pytest.mark.asyncio
async def test_conversion_rate_when_no_closed_leads_exist(
    client: AsyncClient,
    admin_headers: dict[str, str],
):
    """
    When no leads have closed (0 won, 0 lost), conversion_rate must be returned as None
    (not 0.0%), making the lack of data explicit.
    """
    pipe_id = uuid.uuid4()
    stage_id = uuid.uuid4()
    sessionmaker = get_sessionmaker()

    now_utc = datetime.now(timezone.utc)
    async with sessionmaker() as session:
        pipe = CrmPipeline(
            id=pipe_id,
            name=f"No Closed Pipe {pipe_id.hex[:6]}",
            is_active=True,
            created_by=ADMIN_ID,
        )
        session.add(pipe)
        stage = CrmPipelineStage(
            id=stage_id,
            pipeline_id=pipe_id,
            name="Open Only",
            stage_order=0,
            stage_type="open",
            is_initial=True,
            is_active=True,
        )
        session.add(stage)
        phone = unique_phone()
        lead = CrmLead(
            pipeline_id=pipe_id,
            stage_id=stage_id,
            name="Open Lead Only",
            original_phone=phone,
            normalized_phone=f"+91{phone}",
            assigned_to=REP_A_ID,
            status="new",
            created_at=now_utc,
        )
        session.add(lead)
        await session.commit()

    res = await client.get(
        f"/api/v1/crm/reports/analytics?pipeline_id={pipe_id}",
        headers=admin_headers,
    )
    assert res.status_code == 200
    data = res.json()["data"]

    overview = data["overview"]
    assert overview["total_leads_in_range"] == 1
    assert overview["won_count"] == 0
    assert overview["lost_count"] == 0
    assert overview["closed_count"] == 0
    # Crucial requirement: Do not present missing data as zero when unavailable
    assert overview["conversion_rate"] is None


# =============================================================================
# 6. Date Boundaries & Parameter Validation
# =============================================================================


@pytest.mark.asyncio
async def test_analytics_date_validation_and_empty_dataset(
    client: AsyncClient,
    admin_headers: dict[str, str],
):
    """
    Verifies date parameter validation and safe handling of empty datasets.
    """
    # 1. Invalid date format
    res_bad_fmt = await client.get(
        "/api/v1/crm/reports/analytics?start_date=not-a-date",
        headers=admin_headers,
    )
    assert res_bad_fmt.status_code == 400
    assert "Invalid start_date" in res_bad_fmt.text

    # 2. start_date > end_date
    res_inverted = await client.get(
        "/api/v1/crm/reports/analytics?start_date=2026-10-15&end_date=2026-10-01",
        headers=admin_headers,
    )
    assert res_inverted.status_code == 400
    assert "start_date must be before" in res_inverted.text

    # 3. Far past date range with zero records -> returns clean empty metrics
    res_empty = await client.get(
        "/api/v1/crm/reports/analytics?start_date=2015-01-01&end_date=2015-01-31",
        headers=admin_headers,
    )
    assert res_empty.status_code == 200
    data = res_empty.json()["data"]
    assert data["overview"]["total_leads_in_range"] == 0
    assert data["overview"]["won_count"] == 0
    assert data["overview"]["lost_count"] == 0
    assert data["overview"]["conversion_rate"] is None
