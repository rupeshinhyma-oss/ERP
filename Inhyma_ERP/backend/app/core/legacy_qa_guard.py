"""
Legacy Synthetic QA File Sweeper & Live-Database Guard.

Ensures that retired QA provisioning scripts and live-database test suites
(removed in commit ``c96e730``) cannot linger as untracked or copied files on
developer/colleague machines and accidentally write synthetic users or tasks
(``rec_mgr_*``, ``rec_user_*``, ``*@inhyma.test``) into shared Supabase databases.
"""

from __future__ import annotations

from pathlib import Path

# Relative to Inhyma_ERP/ (parent of backend/)
RETIRED_SYNTHETIC_QA_FILES: tuple[str, ...] = (
    "backend/scripts/cleanup_local_crm_qa_data.py",
    "backend/scripts/prepare_minimal_crm_qa_data.py",
    "backend/scripts/provision_feed_test_accounts.py",
    "backend/scripts/provision_hrms_qa_matrix.py",
    "backend/scripts/provision_tasks_qa_personas.py",
    "backend/scripts/seed_crm_qa_demo_data.py",
    "backend/tests/test_crm_assignment_engine.py",
    "backend/tests/test_crm_company_integration.py",
    "backend/tests/test_crm_csv_import.py",
    "backend/tests/test_crm_distribution_and_reassignment.py",
    "backend/tests/test_crm_follow_up_workforce_task_integration.py",
    "backend/tests/test_crm_import_assignment_integration.py",
    "backend/tests/test_crm_kanban_stage_transitions.py",
    "backend/tests/test_crm_lead_detail_and_activities.py",
    "backend/tests/test_crm_leads_visibility.py",
    "backend/tests/test_crm_lifecycle_and_followups.py",
    "backend/tests/test_crm_manual_lead_creation.py",
    "backend/tests/test_crm_phase1_foundation.py",
    "backend/tests/test_crm_phase6_corrections.py",
    "backend/tests/test_crm_pipeline_setup.py",
    "backend/tests/test_crm_quotations_and_products.py",
    "backend/tests/test_crm_reports_and_analytics.py",
    "backend/tests/test_crm_salesperson_distribution.py",
    "backend/tests/test_feed_broadcast.py",
    "backend/tests/test_feed_interactions.py",
    "backend/tests/test_feed_open_access_and_messaging.py",
    "backend/tests/test_feed_phase5_e2e.py",
    "backend/tests/test_feed_security_audit.py",
    "backend/tests/test_hrms_assets.py",
    "backend/tests/test_hrms_attendance.py",
    "backend/tests/test_hrms_expenses.py",
    "backend/tests/test_hrms_final_enhancements.py",
    "backend/tests/test_hrms_leave_adjustments_and_balances.py",
    "backend/tests/test_hrms_leave_corrections.py",
    "backend/tests/test_hrms_leave_phase1.py",
    "backend/tests/test_hrms_leave_phase2.py",
    "backend/tests/test_hrms_payroll.py",
    "backend/tests/test_hrms_phases2_6_matrix.py",
    "backend/tests/test_hrms_setup.py",
    "backend/tests/test_hrms_site_visit_and_tracking.py",
    "backend/tests/test_section24_acceptance_scenarios.py",
    "backend/tests/test_tasks_recurring.py",
    "scratch/cleanup_and_reseed.py",
    "scratch/inspect_for_cleanup.py",
    "scratch/verify_role_access.py",
)


def purge_retired_qa_files(inhyma_root: Path | None = None) -> list[str]:
    """
    Delete any retired synthetic-QA scripts/tests if still present on disk
    (for example as untracked or manually copied files on a colleague system).

    Returns the list of relative paths removed.
    """
    root = inhyma_root or Path(__file__).resolve().parents[3]
    removed: list[str] = []
    for rel_path in RETIRED_SYNTHETIC_QA_FILES:
        target = root / rel_path
        if target.is_file():
            try:
                target.unlink()
                removed.append(rel_path)
            except OSError:
                pass
    return removed
