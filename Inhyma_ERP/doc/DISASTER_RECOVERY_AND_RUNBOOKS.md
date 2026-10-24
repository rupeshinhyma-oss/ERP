# Inhyma_ERP — Disaster Recovery & Operational Runbooks

**System:** Inhyma_ERP (India Distribution Node)  
**Database:** PostgreSQL (`inhyma_erp` schema)  
**Storage:** Supabase Storage (`product-images`, `quotations`) with local disk fallback

---

## 1. Failure Scenarios & Local Recovery

### Scenario A: Local Database Pooler Outage
1. If the Supabase transaction pooler is unreachable:
   - Switch `DATABASE_URL` in `Inhyma_ERP/backend/.env` from pooler port `5432` to direct session port `6543`.
   - Restart the backend worker.

### Scenario B: WebSocket Server Interruption
1. If WebSocket connection drops (`ws://localhost:8002/api/v1/events/ws`):
   - Frontend `liveClient.ts` will automatically execute exponential backoff retries.
   - If server fails to reconnect, verify `backend/app/events/manager.py` state and restart backend.

### Scenario C: Alembic Version Desynchronization (Can't locate revision identified by '...')
1. If `alembic upgrade head` halts with an error like `Can't locate revision identified by 'xyz'`:
   - An invalid or mistyped revision identifier exists in the database `alembic_version` table.
   - Run Runbook **RB-03** below to re-align the revision pointer with the actual applied migration state.

### Scenario D: Multiple Head Revisions Halting Deployment Startup
1. If deployment startup halts with exit code 255 and log:
   `FAILED: Multiple head revisions are present for given argument 'head'; please specify a specific target revision, '<branchname>@head' to narrow to a specific head, or 'heads' for all heads`
   - Two or more migration files were committed with parallel branch points.
   - Execute Runbook **RB-04** below to merge the branches into a single linear head.

---

## 2. Standard Operating Procedures (Runbooks)

### RB-01: Supabase Asset Sync to Cloud Storage
If files were uploaded to local disk storage (`uploads/`) during cloud service unavailability, execute the asset synchronization tool:
```bash
python scripts/sync_uploads_to_supabase.py
```
This utility scans local disk folders, uploads them to Supabase Storage, and updates PostgreSQL database references with global URLs.

### RB-02: Deprovisioning Reconciliation Drill
To verify deprovisioning state on Inhyma ERP:
1. Verify user has `deleted_at IS NOT NULL` and `is_active = FALSE`.
2. Confirm user does not appear in `GET /api/v1/users` table.

### RB-03: Alembic Version Table Desynchronization Recovery
When the database `alembic_version` table points to an unknown revision:
1. Identify the last schema table/columns successfully applied in PostgreSQL (e.g. check for `option_lists`, `companies`, etc.).
2. Find the corresponding migration in `backend/alembic/versions/*.py`.
3. In PostgreSQL (or via a one-off python script with `app.database.engine`):
   ```sql
   UPDATE alembic_version SET version_num = '<valid_applied_revision_id>';
   ```
4. Re-run migration verification:
   ```bash
   python -m alembic current
   python -m alembic upgrade heads
   ```
5. Confirm all pending migrations apply linearly to `heads`.

### RB-04: Resolving Divergent Migration Heads (Merge Migration)
When Alembic detects multiple unmerged leaf revisions:
1. Inspect the conflicting heads:
   ```bash
   cd Inhyma_ERP/backend
   python -m alembic heads
   ```
2. Generate an explicit merge migration revision:
   ```bash
   python -m alembic merge heads -m "merge_divergent_heads"
   ```
3. Inspect the newly created migration in `backend/alembic/versions/` and ensure `down_revision = ('rev1', 'rev2')`.
4. Apply the merge migration:
   ```bash
   python -m alembic upgrade heads
   ```
5. Verify that `python -m alembic heads` returns strictly 1 head.
6. Run the automated migration head test:
   ```bash
   python -m pytest tests/test_migrations_match_models.py::test_single_migration_head -v
   ```
7. Commit the new merge migration file and push to Git to enable clean production deployment.


