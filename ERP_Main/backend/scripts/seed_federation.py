"""
Seed Federation Clients and Service Credentials for Yinglima and Inhyma ERPs.

Idempotently configures:
1. FederationClient in ERP_Main for 'inhyma' and 'yinglima' with federation_enabled=True.
2. ErpServiceCredential in ERP_Main for 'inhyma' and 'yinglima'.
3. Updates ErpMembership.local_user_id for admin accounts to match the local admin UUIDs.
4. Synchronizes FEDERATION_CLIENT_ID, FEDERATION_CLIENT_SECRET, and
   FEDERATION_SERVICE_CREDENTIAL into Inhyma_ERP/backend/.env and Yinglima_ERP/backend/.env.
"""

from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timezone
from pathlib import Path
import secrets
import sys

# Ensure backend root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select

from app.database.engine import dispose_engine, get_sessionmaker
from app.erp_memberships.models import ErpMembership, ErpMembershipStatus
from app.erp_registry.models import ErpInstance
from app.federation.models import FederationClient
from app.federation.service import _hash_client_secret
from app.service_identity.models import ErpServiceCredential
from app.service_identity.security import (
    generate_credential_identifier,
    generate_service_secret,
    hash_service_secret,
)

ROOT_DIR = Path(__file__).resolve().parent.parent.parent.parent


def update_env_file(env_path: Path, updates: dict[str, str]) -> None:
    """Idempotently add or update key=value pairs in a .env file."""
    if not env_path.exists():
        lines = []
    else:
        lines = env_path.read_text(encoding="utf-8").splitlines()

    updated_keys = set()
    new_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key = stripped.split("=", 1)[0].strip()
            if key in updates:
                new_lines.append(f"{key}={updates[key]}")
                updated_keys.add(key)
                continue
        new_lines.append(line)

    for key, val in updates.items():
        if key not in updated_keys:
            new_lines.append(f"{key}={val}")

    env_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")


def read_env_values(env_path: Path) -> dict[str, str]:
    """Read key-value pairs from a .env file."""
    if not env_path.exists():
        return {}
    res = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            parts = stripped.split("=", 1)
            res[parts[0].strip()] = parts[1].strip()
    return res


async def seed_federation_with_session(session) -> None:
    """Run idempotent federation seeding using an open session."""
    # 1. Fetch ERP instances
    instances_stmt = select(ErpInstance)
    instances = (await session.scalars(instances_stmt)).all()
    instance_by_key = {inst.key: inst for inst in instances}

    erp_configs = {
        "inhyma": {
            "name": "Inhyma ERP",
            "env_path": ROOT_DIR / "Inhyma_ERP" / "backend" / ".env",
            "admin_uuid": "ea2b5763-5a4d-4f21-8bff-adc3e6cb8235",
            "redirect_uris": [
                "http://localhost:5174/auth/callback",
                "http://127.0.0.1:5174/auth/callback",
                "http://localhost:5174/dashboard/auth/callback",
                "http://127.0.0.1:5174/dashboard/auth/callback",
            ],
            "prefix": "INHYMA",
        },
        "yinglima": {
            "name": "Yinglima ERP",
            "env_path": ROOT_DIR / "Yinglima_ERP" / "backend" / ".env",
            "admin_uuid": "84d1a995-261c-4c6d-94ef-7667b759c460",
            "redirect_uris": [
                "http://localhost:5173/auth/callback",
                "http://127.0.0.1:5173/auth/callback",
                "http://localhost:5173/dashboard/auth/callback",
                "http://127.0.0.1:5173/dashboard/auth/callback",
            ],
            "prefix": "YINGLIMA",
        },
    }

    for key, cfg in erp_configs.items():
        inst = instance_by_key.get(key)
        if not inst:
            print(f"Warning: ErpInstance '{key}' not found in database. Run seed_registry first.")
            continue

        existing_env = read_env_values(cfg["env_path"])

        # -------------------------------------------------------------
        # A. Federation Client (OIDC RP)
        # -------------------------------------------------------------
        client_stmt = select(FederationClient).where(FederationClient.erp_instance_id == inst.id)
        client = await session.scalar(client_stmt)

        env_client_id = existing_env.get("FEDERATION_CLIENT_ID", "")
        env_client_secret = existing_env.get("FEDERATION_CLIENT_SECRET", "")

        # If client secret is not in .env or no client exists, generate a fresh secret
        if not env_client_secret:
            plain_secret = secrets.token_urlsafe(32)
        else:
            plain_secret = env_client_secret

        if client is None:
            client_id = env_client_id or f"erp-{key}-{secrets.token_hex(4)}"
            client = FederationClient(
                erp_instance_id=inst.id,
                client_id=client_id,
                client_secret_hash=_hash_client_secret(plain_secret),
                redirect_uris=cfg["redirect_uris"],
                federation_enabled=True,
            )
            session.add(client)
            await session.flush()
            print(f"Created FederationClient for {key}: client_id={client.client_id}")
        else:
            client.federation_enabled = True
            # Merge redirect URIs
            current_uris = set(client.redirect_uris or [])
            for uri in cfg["redirect_uris"]:
                current_uris.add(uri)
            client.redirect_uris = sorted(list(current_uris))
            # Ensure client_secret_hash matches the plain_secret if generating/updating
            if not env_client_secret:
                client.client_secret_hash = _hash_client_secret(plain_secret)
            await session.flush()
            print(f"Updated FederationClient for {key}: client_id={client.client_id} (enabled=True)")

        # -------------------------------------------------------------
        # B. Service Credential (Internal ERP_Main API caller)
        # -------------------------------------------------------------
        cred_stmt = select(ErpServiceCredential).where(
            ErpServiceCredential.erp_instance_id == inst.id,
            ErpServiceCredential.revoked_at.is_(None),
        )
        service_cred = await session.scalar(cred_stmt)

        env_service_cred = existing_env.get("FEDERATION_SERVICE_CREDENTIAL", "")
        bearer_token = env_service_cred

        if service_cred is None:
            identifier = generate_credential_identifier()
            secret = generate_service_secret()
            service_cred = ErpServiceCredential(
                erp_instance_id=inst.id,
                credential_identifier=identifier,
                secret_hash=hash_service_secret(secret),
                expires_at=None,
            )
            session.add(service_cred)
            await session.flush()
            bearer_token = f"{identifier}.{secret}"
            print(f"Created ErpServiceCredential for {key}: identifier={identifier}")
        else:
            if not env_service_cred or "." not in env_service_cred:
                # Rotate/recreate to get a known plaintext token for .env
                identifier = generate_credential_identifier()
                secret = generate_service_secret()
                service_cred.credential_identifier = identifier
                service_cred.secret_hash = hash_service_secret(secret)
                await session.flush()
                bearer_token = f"{identifier}.{secret}"
                print(f"Reset ErpServiceCredential for {key}: identifier={identifier}")

        # -------------------------------------------------------------
        # C. Update ErpMembership local_user_id from '1' to real UUID
        # -------------------------------------------------------------
        mems_stmt = select(ErpMembership).where(ErpMembership.erp_instance_id == inst.id)
        memberships = (await session.scalars(mems_stmt)).all()
        for mem in memberships:
            if mem.local_user_id == "1":
                mem.local_user_id = cfg["admin_uuid"]
                mem.status = ErpMembershipStatus.ACTIVE
                print(f"Updated membership for {key}: local_user_id='1' -> '{cfg['admin_uuid']}'")

        # -------------------------------------------------------------
        # D. Update ERP's backend/.env file
        # -------------------------------------------------------------
        env_updates = {
            "FEDERATION_CLIENT_ID": client.client_id,
            "FEDERATION_CLIENT_SECRET": plain_secret,
            "FEDERATION_SERVICE_CREDENTIAL": bearer_token,
            f"{cfg['prefix']}_SSO_ENABLED": "true",
            "ERP_MAIN_ISSUER": "http://127.0.0.1:8000",
            "ERP_MAIN_JWKS_URL": "http://127.0.0.1:8000/api/v1/.well-known/jwks.json",
            "ERP_MAIN_API_BASE_URL": "http://127.0.0.1:8000/api/v1",
        }
        update_env_file(cfg["env_path"], env_updates)
        print(f"Synchronized federation settings in {cfg['env_path'].relative_to(ROOT_DIR)}")


async def main() -> None:
    session_factory = get_sessionmaker()
    async with session_factory() as session:
        await seed_federation_with_session(session)
        await session.commit()
    await dispose_engine()
    print("Federation seeding completed successfully.")


if __name__ == "__main__":
    asyncio.run(main())
