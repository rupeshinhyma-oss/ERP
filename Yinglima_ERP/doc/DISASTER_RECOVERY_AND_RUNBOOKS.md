# Yinglima_ERP — Disaster Recovery & Operational Runbooks

**System:** Yinglima_ERP (China Procurement Node)  
**Database:** PostgreSQL (`yinglima_erp` schema)  
**Storage:** Supabase Storage (`supplier-media`, `quotations`)

---

## 1. Failure Scenarios & Local Recovery

### Scenario A: IMAP Mailbox Poller Re-Authentication Failure
1. If the background IMAP worker fails with authentication errors:
   - Check `IMAP_USERNAME` and `IMAP_PASSWORD` (Google App Password) in `Yinglima_ERP/backend/.env`.
   - Verify 2-Factor Authentication state on the dedicated mailbox (`quotes@...`).
   - Restart the email polling worker service.

### Scenario B: Outbox Event Delivery Backpressure
1. If events to `ERP_Main` fail due to network partitioning:
   - The Transactional Outbox worker retries with exponential backoff.
   - Inspect outbox table: `SELECT count(*) FROM outbox_events WHERE status = 'PENDING';`.
   - Outbox events remain durable in local PostgreSQL until successful transmission.

---

## 2. Standard Operating Procedures (Runbooks)

### RB-01: Supabase Media Synchronization Drill
If quotation PDFs or factory visit media were saved to local disk during a cloud outage, execute:
```bash
python scripts/sync_uploads_to_supabase.py
```
This utility uploads all offline files to Supabase Storage and updates database records.
