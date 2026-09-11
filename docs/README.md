# Multi-ERP Platform — Official Documentation Index

Welcome to the official technical documentation library for the Multi-ERP Platform (`ERP_Main`, `Yinglima_ERP`, and `Inhyma_ERP`).

All documentation files are organized within this directory (`ERP/docs/`):

---

## Primary Documentation Guides

| Document | Description | Target Audience |
|---|---|---|
| **[MASTER_ERP_ECOSYSTEM_DOCUMENTATION.md](MASTER_ERP_ECOSYSTEM_DOCUMENTATION.md)** | **The Complete Technical Reference Manual.** Exhaustive coverage of architecture, boundaries, Supabase PostgreSQL database setup, all features and modules across ERP_Main, Yinglima, and Inhyma, cross-system workflows, CI/CD, and disaster recovery. | All Developers, Architects, SREs |
| **[DISASTER_RECOVERY_PLAN.md](DISASTER_RECOVERY_PLAN.md)** | **Disaster Recovery & Business Continuity.** Playbooks for Scenarios A through F (ERP_Main down, partner down, database cloud outage, failed deployments, corrupted projections) with RTO < 15 min and RPO < 1 min. | SREs, Incident Commanders |
| **[OPERATIONAL_RUNBOOKS.md](OPERATIONAL_RUNBOOKS.md)** | **Standard Operating Procedures.** Runbooks RB-01 to RB-07 covering production deployment, safe migrations, zero-downtime rollback, PITR drills, DLQ replay, key rotation, and worker incident recovery. | On-Call Engineers, Operations |

---

## Launch & Readiness Reports (Project Root)

- **[FINAL_PRODUCTION_READINESS_REPORT.md](../FINAL_PRODUCTION_READINESS_REPORT.md)**: Definitive 27-area production readiness matrix and final launch sign-off (`PRODUCTION READY WITH DOCUMENTED RISKS`).
- **[PRODUCTION_READINESS_GAPS.md](../PRODUCTION_READINESS_GAPS.md)**: Operational risk register classifying known gaps (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `FUTURE`) with compensating controls.
- **[PHASE_9_PRODUCTION_READINESS_REPORT.md](../PHASE_9_PRODUCTION_READINESS_REPORT.md)**: Phase 9 boundary audit and end-to-end integration test results.

---

## Quick Reference Commands

### Production Configuration Validation
```bash
python scripts/validate_production_config.py --env staging
python scripts/validate_production_config.py --env production
```

### Production Smoke Testing Harness
```bash
python scripts/production_smoke_test.py
```

### Containerized Stack (Local Simulation)
```bash
docker compose -f docker-compose.prod.yml up -d
```
