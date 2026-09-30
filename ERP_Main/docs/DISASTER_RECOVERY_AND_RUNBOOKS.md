# ERP_Main — Disaster Recovery & Operational Runbooks

**System:** ERP_Main (Control Plane)  
**Criticality:** High (Single Point of Identity & Access Failure)  
**RTO Target:** < 15 minutes  
**RPO Target:** < 1 minute

---

## 1. Failure Scenarios & Recovery Playbooks

### Scenario A: Control Plane Service Outage
1. **Impact:** Spoke ERP users cannot switch ERPs or log in via central SSO. Active local spoke sessions continue functioning autonomously.
2. **Triage:**
   - Check FastAPI backend service: `http://localhost:8000/healthz`.
   - Inspect database pool connection stats.
3. **Recovery Steps:**
   - Restart service via PM2 / systemd / Docker: `docker-compose restart erp_main_backend`.
   - Verify JWKS key sets load at `/.well-known/jwks.json`.

### Scenario B: Database Pooler Outage (Supabase)
1. **Action:** If the cloud pooler (`pooler.supabase.com:5432`) is unreachable, failover to direct database session port `6543` or local standby PostgreSQL.
2. **Environment Update:** Update `DATABASE_URL` in `ERP_Main/backend/.env` and restart.

---

## 2. Standard Operating Procedures (Runbooks)

### RB-01: Asymmetric Key Rotation (OIDC & JWT)
1. Generate new 2048-bit RSA key pair:
   ```bash
   openssl genrsa -out private_key_new.pem 2048
   openssl rsa -in private_key_new.pem -pubout -out public_key_new.pem
   ```
2. Append new public key to JWKS rotation list in `app/oidc/jwks.py`.
3. Allow 24 hours for token propagation across spoke ERPs before deprecating the previous key.

### RB-02: Spoke Node Deprovisioning Emergency Drill
1. To force immediate deprovisioning of an compromised user across all spokes:
   ```bash
   curl -X POST http://localhost:8000/api/v1/global/users/{id}/emergency-deprovision \
     -H "Authorization: Bearer <SUPER_ADMIN_TOKEN>"
   ```
2. Verifies that all registered spoke endpoints return 200 OK deprovision confirmation.
