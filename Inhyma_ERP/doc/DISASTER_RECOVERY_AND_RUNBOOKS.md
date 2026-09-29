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
