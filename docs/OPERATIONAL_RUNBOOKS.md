# Operational Runbooks — Multi-ERP Platform

**Target Audience:** DevOps Engineers, Platform Operators, and SREs  
**Scope:** Production maintenance, incident response, deployment, and disaster recovery.  

---

## Runbook Directory
- [RB-01: Production Application Deployment](#rb-01-production-application-deployment)
- [RB-02: Safe Database Migrations on Supabase PostgreSQL](#rb-02-safe-database-migrations-on-supabase-postgresql)
- [RB-03: Zero-Downtime Application & Database Rollback](#rb-03-zero-downtime-application--database-rollback)
- [RB-04: Supabase Point-in-Time Recovery (PITR) & Restore Drill](#rb-04-supabase-point-in-time-recovery-pitr--restore-drill)
- [RB-05: Integration Dead-Letter Queue (DLQ) Triage & Replay](#rb-05-integration-dead-letter-queue-dlq-triage--replay)
- [RB-06: OIDC Signing Key & Secret Rotation](#rb-06-oidc-signing-key--secret-rotation)
- [RB-07: Background Queue Worker Incident Recovery](#rb-07-background-queue-worker-incident-recovery)

---

## RB-01: Production Application Deployment

### Prerequisites:
1. All unit and integration tests pass in CI (`pytest -v` across all 3 backends: 491 passed).
2. Frontend builds succeed with zero warnings (`npm run build`).
3. Pre-flight configuration validation succeeds:
   ```bash
   python scripts/validate_production_config.py --env production
   ```

### Execution Steps:
1. **Trigger Production Deployment via GitHub Actions:**
   - Navigate to **Actions** -> **Multi-ERP Production Release & Deployment Pipeline**.
   - Select release tag / branch and choose `environment: production`.
2. **Container Build & Rolling Rollout:**
   ```bash
   # Build images
   docker build -t erp-main-backend:latest ./ERP_Main/backend
   docker build -t yinglima-backend:latest ./Yinglima_ERP/backend
   docker build -t inhyma-backend:latest ./Inhyma_ERP/backend

   # Rolling update (Kubernetes / Docker Compose)
   docker compose -f docker-compose.prod.yml up -d --no-deps --build erp-main-api yinglima-api inhyma-api
   ```
3. **Execute Post-Deployment Smoke Tests:**
   ```bash
   python scripts/production_smoke_test.py
   ```

---

## RB-02: Safe Database Migrations on Supabase PostgreSQL

### When to Execute:
Whenever a new schema revision (`alembic/versions/*.py`) is introduced.

### Execution Steps:
1. **Verify Single Migration Head per Repository:**
   ```bash
   cd ERP_Main/backend && alembic heads
   cd Yinglima_ERP/backend && alembic heads
   cd Inhyma_ERP/backend && alembic heads
   ```
2. **Execute Production Migration:**
   ```bash
   # Run sequentially with synchronous driver / direct URL
   cd ERP_Main/backend && alembic upgrade head
   cd Yinglima_ERP/backend && alembic upgrade head
   cd Inhyma_ERP/backend && alembic upgrade head
   ```
4. **Confirm Migration State:**
   - Query `alembic_version` in each database:
     ```sql
     SELECT version_num FROM alembic_version;
     ```

---

## RB-03: Zero-Downtime Application & Database Rollback

### Step 1: Application Reversion
Revert the container images to the previous stable release tag:
```bash
kubectl rollout undo deployment/erp-main-api
kubectl rollout undo deployment/yinglima-api
kubectl rollout undo deployment/inhyma-api
```

### Step 2: Database Reversion Check
- **If migrations followed Expand/Contract:** The old application version can safely run against the expanded schema without running any database downgrade.
- **If destructive downgrade is unavoidable:**
  ```bash
  alembic downgrade -1
  ```

---

## RB-04: Supabase Point-in-Time Recovery (PITR) & Restore Drill

### Purpose:
Recover data from unintentional table truncation, data loss, ransomware, or corruption.

### Steps:
1. Identify the incident timestamp $T_{\text{target}}$ (UTC).
2. Open Supabase Dashboard -> **Settings** -> **Database** -> **Backups**.
3. Under **Point in Time Analysis**, select the recovery target timestamp prior to corruption.
4. If restoring from a physical dump:
   ```bash
   pg_restore -d "$DIRECT_URL" -v -c erp_backup.dump
   ```
5. Update deployment configuration secret `DATABASE_URL` if restoring to a fresh project.
6. Run database migrations to ensure schema currency:
   ```bash
   alembic upgrade head
   ```
7. Restart backend pods:
   ```bash
   kubectl rollout restart deployment/erp-main-api
   ```
8. Verify readiness probe: `GET /api/v1/health/ready`.

---

## RB-05: Integration Dead-Letter Queue (DLQ) Triage & Replay

### Detection:
Alert: `DeadLetterQueueBacklog > 0` on `ERP_Main`.

### Steps:
1. **Inspect Dead-Letter Entries:**
   ```bash
   curl -H "Authorization: Bearer <PLATFORM_ADMIN_TOKEN>" \
        https://erp-main.domain.com/api/v1/internal/integration/dead-letters
   ```
2. **Review Error Stack Trace:**
   - Inspect `failure_reason` and `payload`.
   - Identify whether the failure is schema validation, network timeout, or downstream projection error.
3. **Replay DLQ Events:**
   ```bash
   curl -X POST -H "Authorization: Bearer <PLATFORM_ADMIN_TOKEN>" \
        https://erp-main.domain.com/api/v1/internal/integration/dead-letters/{event_id}/replay
   ```
4. **Rebuild Projections if Necessary:**
   ```bash
   curl -X POST -H "Authorization: Bearer <PLATFORM_ADMIN_TOKEN>" \
        https://erp-main.domain.com/api/v1/global/projections/rebuild
   ```

---

## RB-06: OIDC Signing Key & Secret Rotation

### Key Rotation Procedure (Zero User Invalidation):
1. **Trigger Key Rotation in ERP_Main:**
   ```bash
   curl -X POST -H "Authorization: Bearer <PLATFORM_ADMIN_TOKEN>" \
        https://erp-main.domain.com/api/v1/global/federation/keys/rotate
   ```
2. **Mechanism:**
   - A new RS256 private/public keypair is generated.
   - The new key is marked `ACTIVE`.
   - The previous key is marked `RETIRED` but retained in the JWKS set for a 24-hour grace period so active in-flight tokens can still be verified.
3. **Verify Public JWKS Endpoint:**
   ```bash
   curl https://erp-main.domain.com/api/v1/.well-known/jwks.json
   ```
   Confirm both the new and retired keys are present in the `keys` array.

---

## RB-07: Background Queue Worker Incident Recovery

### Detection:
Alert: `WorkerHeartbeatMissing` or jobs remaining in `RUNNING` status $> 30$ minutes.

### Steps:
1. **Inspect Worker Process:**
   ```bash
   docker logs yinglima-worker --tail 100
   ```
2. **Restart Worker Pod:**
   ```bash
   docker compose restart yinglima-worker
   ```
3. **Auto-Recovery:**
   - On startup, `BackgroundWorker` checks `_maybe_recover_stuck_jobs()`.
   - Any job in `RUNNING` status older than 30 minutes is automatically reset to `PENDING` with retry count incremented.
4. **Verify Queue Status:**
   ```bash
   curl -H "Authorization: Bearer <ADMIN_TOKEN>" \
        https://yinglima.domain.com/api/v1/queue/stats
   ```
