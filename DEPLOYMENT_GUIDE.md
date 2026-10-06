# Multi-ERP Enterprise Platform — Production Deployment Guide

A unified guide for hosting and deploying the Multi-ERP ecosystem (**ERP_Main Control Plane**, **Inhyma_ERP**, and **Yinglima_ERP**) across cloud platforms including **DigitalOcean**, **Render.com**, and **Amazon Web Services (AWS)**.

---

## 1. System Ecosystem & Port Mapping

| System | Role | Default Local Web | Default Local API | Production Subdomain (Example) |
| :--- | :--- | :--- | :--- | :--- |
| **`ERP_Main`** | Global Control Plane & OIDC Authority | `http://127.0.0.1:5170` | `http://127.0.0.1:8000` | `https://admin.yourcompany.com` |
| **`Yinglima_ERP`** (`erp-02`) | China Sourcing & Procurement Spoke | `http://127.0.0.1:5173` | `http://127.0.0.1:8001` | `https://yinglima.yourcompany.com` |
| **`Inhyma_ERP`** (`erp-01`) | India Distribution & Sales Spoke | `http://127.0.0.1:5174` | `http://127.0.0.1:8002` | `https://inhyma.yourcompany.com` |

---

## 2. Deployment Architecture & URL Handling

All three systems support two primary hosting topologies:

### Topology A: Single-Domain Reverse Proxy (Recommended)
Each ERP system is hosted under its own dedicated domain or subdomain where a web server / reverse proxy (such as Nginx, Cloudflare, or AWS ALB) routes:
- `/api/*` $\rightarrow$ FastAPI Backend Server
- `/*` $\rightarrow$ Built React SPA (`dist/index.html`)

Under this topology:
- Frontend `VITE_API_ORIGIN` is left **blank (`""`)** because API requests use relative paths (`/api/v1/...`).
- No cross-origin browser issues or CORS preflight latency.

### Topology B: Split Web & API Domains
Frontend and Backend are hosted on distinct hostnames:
- Frontend: `https://inhyma.yourcompany.com`
- Backend API: `https://inhyma-api.yourcompany.com`

Under this topology:
- Frontend must be built with `VITE_API_ORIGIN=https://inhyma-api.yourcompany.com`.
- Backend must set `CORS_ALLOWED_ORIGINS=https://inhyma.yourcompany.com`.
- Auth cookies must set `AUTH_USE_SECURE_COOKIES=true` and `VITE_COOKIE_DOMAIN=.yourcompany.com`.

---

## 3. Production Environment Variables Reference

### A. Inhyma_ERP (`Inhyma_ERP/backend/.env` & `frontend/.env`)
```ini
# Backend (Inhyma_ERP/backend/.env)
ENVIRONMENT=production
DEBUG=false
HOST=0.0.0.0
PORT=8002
BACKEND_URL=https://inhyma-api.yourcompany.com
FRONTEND_URL=https://inhyma.yourcompany.com

# Database (Supabase PostgreSQL Transaction Pooler)
DATABASE_URL=postgresql+asyncpg://postgres.<REF>:<PASS>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?ssl=require
DIRECT_URL=postgresql://postgres.<REF>:<PASS>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require
DATABASE_POOL_SIZE=10
DATABASE_DISABLE_STATEMENT_CACHE=true

# Security Secrets (Must not be placeholder strings)
JWT_SECRET_KEY=<generate-64-character-random-secret>
MEMBER_PASSWORD_ENCRYPTION_KEY=<generate-unique-encryption-key>
AUTH_USE_SECURE_COOKIES=true

# CORS (Strict comma-separated whitelist; '*' is rejected in production)
CORS_ALLOWED_ORIGINS=https://inhyma.yourcompany.com,https://admin.yourcompany.com

# Federation & SSO
ERP_MAIN_ISSUER=https://admin.yourcompany.com
ERP_MAIN_JWKS_URL=https://admin-api.yourcompany.com/api/v1/.well-known/jwks.json
ERP_MAIN_API_BASE_URL=https://admin-api.yourcompany.com/api/v1
FEDERATION_CLIENT_ID=<issued-by-erp-main>
FEDERATION_SERVICE_CREDENTIAL=<issued-by-erp-main>
PEER_ERP_ENDPOINTS=inhyma=https://inhyma-api.yourcompany.com/api/v1,yinglima=https://yinglima-api.yourcompany.com/api/v1
```

```ini
# Frontend (Inhyma_ERP/frontend/.env)
VITE_API_ORIGIN=https://inhyma-api.yourcompany.com
VITE_CONTROL_PLANE_URL=https://admin.yourcompany.com/dashboard
VITE_CONTROL_PLANE_API_URL=https://admin-api.yourcompany.com/api/v1
VITE_CENTRAL_AUTH_API=https://admin-api.yourcompany.com/api/v1/global/ecosystem-session
VITE_COOKIE_DOMAIN=.yourcompany.com
VITE_GOOGLE_MAPS_API_KEY=<restricted-google-maps-api-key>
```

---

### B. Yinglima_ERP (`Yinglima_ERP/backend/.env` & `frontend/.env`)
```ini
# Backend (Yinglima_ERP/backend/.env)
ENVIRONMENT=production
DEBUG=false
HOST=0.0.0.0
PORT=8001
BACKEND_URL=https://yinglima-api.yourcompany.com
FRONTEND_URL=https://yinglima.yourcompany.com

# Database (Supabase PostgreSQL Transaction Pooler)
DATABASE_URL=postgresql+asyncpg://postgres.<REF>:<PASS>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?ssl=require
DIRECT_URL=postgresql://postgres.<REF>:<PASS>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require
DATABASE_POOL_SIZE=10
DATABASE_DISABLE_STATEMENT_CACHE=true

# Security Secrets
JWT_SECRET_KEY=<generate-64-character-random-secret>
MEMBER_PASSWORD_ENCRYPTION_KEY=<generate-unique-encryption-key>
AUTH_USE_SECURE_COOKIES=true

# CORS
CORS_ALLOWED_ORIGINS=https://yinglima.yourcompany.com,https://admin.yourcompany.com

# Federation & SSO
ERP_MAIN_ISSUER=https://admin.yourcompany.com
ERP_MAIN_JWKS_URL=https://admin-api.yourcompany.com/api/v1/.well-known/jwks.json
ERP_MAIN_API_BASE_URL=https://admin-api.yourcompany.com/api/v1
PEER_ERP_ENDPOINTS=inhyma=https://inhyma-api.yourcompany.com/api/v1,yinglima=https://yinglima-api.yourcompany.com/api/v1
```

---

### C. ERP_Main (`ERP_Main/backend/.env` & `frontend/.env`)
```ini
# Backend (ERP_Main/backend/.env)
ENVIRONMENT=production
DEBUG=false
HOST=0.0.0.0
PORT=8000
BACKEND_URL=https://admin-api.yourcompany.com
FRONTEND_URL=https://admin.yourcompany.com

# Peer ERP Internal Endpoints (Container or API routes)
YINGLIMA_API_URL=https://yinglima-api.yourcompany.com/api/v1
INHYMA_API_URL=https://inhyma-api.yourcompany.com/api/v1

# Database
DATABASE_URL=postgresql+asyncpg://postgres.<REF>:<PASS>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?ssl=require
DIRECT_URL=postgresql://postgres.<REF>:<PASS>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require

# CORS
CORS_ALLOWED_ORIGINS=https://admin.yourcompany.com,https://inhyma.yourcompany.com,https://yinglima.yourcompany.com
CORS_ALLOW_CREDENTIALS=true

# Platform Auth Secrets
PLATFORM_JWT_SECRET_KEY=<generate-64-character-random-secret>
SERVICE_CREDENTIAL_PEPPER=<generate-random-pepper>
```

---

## 4. Platform-Specific Deployment Guides

### Option 1: Render.com (1-Click Blueprints)
Each application includes a tested `render.yaml` configuration.

1. Connect your GitHub repository to Render.
2. In the Render Dashboard, click **New** $\rightarrow$ **Blueprint**.
3. Select the repository. Render will automatically parse the blueprint:
   - For `Inhyma_ERP`: Point to [`Inhyma_ERP/render.yaml`](Inhyma_ERP/render.yaml).
   - For `Yinglima_ERP`: Point to [`Yinglima_ERP/render.yaml`](Yinglima_ERP/render.yaml).
   - For `ERP_Main`: Point to [`ERP_Main/render.yaml`](ERP_Main/render.yaml).
4. Supply your secret environment variables (`DATABASE_URL`, `DIRECT_URL`, `CORS_ALLOWED_ORIGINS`, `BACKEND_URL`, `FRONTEND_URL`).
5. Render deploys the backend as a Python Web Service with automatic Uvicorn worker process scaling and the frontend as a globally distributed CDN static site with SPA routing rewrites.

---

### Option 2: DigitalOcean (Droplet + Docker Compose or App Platform)

#### Method A: Multi-Service Docker Compose on a Droplet
1. Launch an Ubuntu 22.04 / 24.04 LTS Droplet.
2. Clone the repository and configure your `.env` files in `Inhyma_ERP/backend/.env`, `Yinglima_ERP/backend/.env`, and `ERP_Main/backend/.env`.
3. Run the complete ecosystem stack with a single command:
   ```bash
   docker compose -f docker-compose.ecosystem.yml up -d --build
   ```
4. Set up Nginx or Caddy on the host as a reverse proxy with Let's Encrypt SSL:
   ```nginx
   # Example: Inhyma ERP Subdomain
   server {
       server_name inhyma.yourcompany.com;
       location /api/ {
           proxy_pass http://127.0.0.1:8002;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
       location / {
           proxy_pass http://127.0.0.1:5174;
           proxy_set_header Host $host;
       }
   }
   ```

#### Method B: DigitalOcean App Platform (PaaS)
1. In the DigitalOcean console, click **Create** $\rightarrow$ **Apps** and connect your repo.
2. Add components:
   - **Backend**: Type *Web Service*, source directory `/Inhyma_ERP/backend`, using Dockerfile (`Dockerfile`).
   - **Frontend**: Type *Static Site*, source directory `/Inhyma_ERP/frontend`, build command `npm ci && npm run build`, output directory `dist`. Add catch-all route `/* -> /index.html`.
3. Set environment variables in the App Platform settings.

---

### Option 3: Amazon Web Services (AWS)

#### Method A: AWS ECS (Elastic Container Service) with Fargate
1. Build and push container images to Amazon ECR:
   ```bash
   aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin <ECR_URL>
   docker build -t <ECR_URL>/inhyma-backend:latest ./Inhyma_ERP/backend
   docker push <ECR_URL>/inhyma-backend:latest
   ```
2. Create an ECS Task Definition using the Fargate launch type:
   - Port 8002 mapped for backend.
   - Attach environment variables via AWS Secrets Manager or Systems Manager Parameter Store.
3. Place an Application Load Balancer (ALB) in front with an ACM SSL Certificate (`*.yourcompany.com`):
   - Path `/api/*` forwards to backend target group.
   - Default path `/*` forwards to frontend container or an Amazon S3 + CloudFront static distribution.

#### Method B: AWS App Runner
1. In AWS App Runner, choose Source code repository or Container registry.
2. Direct App Runner to the application Dockerfile:
   - Port: `8002` (Inhyma), `8001` (Yinglima), `8000` (ERP_Main).
3. Configure environment variables in the App Runner console.
4. Custom domains automatically provision managed SSL certificates via AWS Route53.

---

## 5. Pre-Deployment Validation Checklist

Before directing live user traffic to your deployment, verify:

- [ ] **Database Migrations Applied:** Run `alembic upgrade head` across all three databases.
- [ ] **Production Secrets Checked:** Ensure `JWT_SECRET_KEY` and `MEMBER_PASSWORD_ENCRYPTION_KEY` do not contain `"CHANGE-ME"`.
- [ ] **CORS Origins Whitelisted:** Ensure `CORS_ALLOWED_ORIGINS` contains exact domain names without wildcard `*`.
- [ ] **Secure Cookies Enabled:** `AUTH_USE_SECURE_COOKIES=true` on all production backends.
- [ ] **Shared Cookie Domain Configured:** If hosting under a shared root domain (e.g. `*.yourcompany.com`), ensure `VITE_COOKIE_DOMAIN=.yourcompany.com` is set so SSO sessions persist across ERP switches.
- [ ] **Storage Buckets Initialized:** Verify Supabase Storage bucket `inhyma-erp-inquiries` and `yinglima-erp-inquiries` exist.
- [ ] **Health Probes Active:** Test `/api/v1/health/live` returns HTTP 200 on all instances.
