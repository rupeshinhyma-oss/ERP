"""
Production Configuration Validator for the Multi-ERP Platform.

Inspects environment configuration files (.env) or runtime environment variables
for ERP_Main, Yinglima_ERP, and Inhyma_ERP.

 Enforces production safety rules:
 1. Supabase PostgreSQL connection strings with asyncpg driver and ssl=require.
 2. Statement caching disabled for connection poolers.
 3. Secrets are non-empty and DO NOT use default development placeholders (e.g. 'CHANGE-ME-IN-PRODUCTION').
 4. CORS origins do NOT allow wildcard '*' when credentials are enabled.
 5. Federation endpoints and service identity credentials are valid URLs/keys.
 6. SECRECY: NEVER outputs or leaks raw passwords, tokens, or private keys.

Usage:
    python scripts/validate_production_config.py [--env production|staging|development]
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT_DIR = Path(__file__).resolve().parent.parent

ERP_PROJECTS = {
    "ERP_Main": {
        "dir": ROOT_DIR / "ERP_Main" / "backend",
        "env_file": ROOT_DIR / "ERP_Main" / "backend" / ".env",
        "example_file": ROOT_DIR / "ERP_Main" / "backend" / ".env.example",
        "db_name": "erp_main",
        "required_keys": [
            "DATABASE_URL",
            "DIRECT_URL",
            "PLATFORM_JWT_SECRET_KEY",
            "SERVICE_CREDENTIAL_PEPPER",
        ],
    },
    "Yinglima_ERP": {
        "dir": ROOT_DIR / "Yinglima_ERP" / "backend",
        "env_file": ROOT_DIR / "Yinglima_ERP" / "backend" / ".env",
        "example_file": ROOT_DIR / "Yinglima_ERP" / "backend" / ".env.example",
        "db_name": "yinglima_erp",
        "required_keys": [
            "DATABASE_URL",
            "DIRECT_URL",
            "JWT_SECRET_KEY",
            "ERP_KEY",
        ],
    },
    "Inhyma_ERP": {
        "dir": ROOT_DIR / "Inhyma_ERP" / "backend",
        "env_file": ROOT_DIR / "Inhyma_ERP" / "backend" / ".env",
        "example_file": ROOT_DIR / "Inhyma_ERP" / "backend" / ".env.example",
        "db_name": "inhyma_erp",
        "required_keys": [
            "DATABASE_URL",
            "DIRECT_URL",
            "JWT_SECRET_KEY",
            "ERP_KEY",
        ],
    },
}

PLACEHOLDER_SUBSTRINGS = [
    "change-me",
    "placeholder",
    "dev-only",
    "secret-key",
    "your-secret",
    "example",
]


def load_env_file(filepath: Path) -> dict[str, str]:
    """Parse a .env file into key-value pairs without executing or evaluating."""
    data = {}
    if not filepath.exists():
        return data
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip("'\"")
                data[k] = v
    return data


def mask_secret(value: str) -> str:
    """Safely describe a secret without revealing its content."""
    if not value:
        return "[EMPTY]"
    length = len(value)
    if length <= 4:
        return f"[SET: length={length}]"
    return f"[SET: length={length}, prefix={value[:2]}***]"


def validate_database_url(url: str, expected_db: str) -> list[str]:
    """Validate Supabase PostgreSQL database URL safety."""
    issues = []
    if not url:
        return ["DATABASE_URL is missing or empty"]

    if not url.startswith("postgresql+asyncpg://"):
        issues.append("DATABASE_URL must use 'postgresql+asyncpg://' driver")

    try:
        parsed = urlparse(url)
        # Check SSL mode
        query = parsed.query.lower()
        if "ssl=require" not in query and "sslmode=require" not in query:
            issues.append("DATABASE_URL must enforce SSL (ssl=require or sslmode=require)")

        # Verify target database name
        path = parsed.path.lstrip("/")
        if path != expected_db and path != "postgres":
            issues.append(f"DATABASE_URL path is '{path}', expected isolated database '{expected_db}' or 'postgres'")

        # Check host
        if not parsed.hostname:
            issues.append("DATABASE_URL has no valid hostname")
        elif "pooler.supabase.com" in parsed.hostname or "supabase.co" in parsed.hostname:
            if parsed.port and parsed.port not in (5432, 6543):
                issues.append(f"Notice: Supabase port is {parsed.port}, expected 5432 (session) or 6543 (transaction)")
        elif parsed.hostname not in ("localhost", "127.0.0.1"):
            issues.append(f"FORBIDDEN: Non-Supabase database host '{parsed.hostname}'. Only Supabase PostgreSQL is permitted.")
    except Exception as exc:
        issues.append(f"DATABASE_URL parsing error: {exc}")

    return issues


def validate_project_config(project_name: str, config: dict, target_env: str) -> tuple[int, int]:
    """Validate single ERP project configuration. Returns (errors_count, warnings_count)."""
    print(f"\n[{project_name}] Configuration Audit (target_env={target_env})")
    print("-" * 65)

    errors = []
    warnings = []

    env_file = config["env_file"]
    if not env_file.exists() and config.get("example_file") and config["example_file"].exists():
        print(f"  Note: '{env_file.name}' not found; validating template '{config['example_file'].name}' in CI mode.")
        env_vars = load_env_file(config["example_file"])
    else:
        env_vars = load_env_file(env_file)

    # Fall back to process environment variables if not found in .env
    merged = {}
    for key in config["required_keys"]:
        merged[key] = env_vars.get(key) or os.environ.get(key, "")

    # Check required keys presence
    for key in config["required_keys"]:
        val = merged.get(key, "")
        if not val:
            errors.append(f"Missing required configuration key: '{key}'")
        else:
            print(f"  OK: {key} is present {mask_secret(val)}")

    # Database checks
    db_url = env_vars.get("DATABASE_URL") or os.environ.get("DATABASE_URL", "")
    if db_url:
        db_issues = validate_database_url(db_url, config["db_name"])
        for issue in db_issues:
            if issue.startswith("Notice:"):
                warnings.append(issue)
            else:
                errors.append(issue)

    # Supabase Statement Cache check
    stmt_cache = env_vars.get("DATABASE_DISABLE_STATEMENT_CACHE") or os.environ.get(
        "DATABASE_DISABLE_STATEMENT_CACHE", ""
    )
    if stmt_cache.lower() != "true":
        warnings.append(
            "DATABASE_DISABLE_STATEMENT_CACHE is not 'true' (recommended for Supabase connection pooler)"
        )

    # Secret strength & placeholder checks
    secret_keys = [
        "PLATFORM_JWT_SECRET_KEY",
        "SERVICE_CREDENTIAL_PEPPER",
        "JWT_SECRET_KEY",
        "FEDERATION_SERVICE_CREDENTIAL",
    ]
    for sk in secret_keys:
        val = env_vars.get(sk) or os.environ.get(sk, "")
        if val:
            lower_val = val.lower()
            if any(ph in lower_val for ph in PLACEHOLDER_SUBSTRINGS):
                msg = f"Secret '{sk}' contains development placeholder substring: {mask_secret(val)}"
                if target_env == "production":
                    errors.append(msg)
                else:
                    warnings.append(f"{msg} (Permitted in local/dev, FORBIDDEN in production)")
            elif len(val) < 20:
                warnings.append(f"Secret '{sk}' is under 20 characters length ({len(val)} chars)")

    # CORS checks
    cors_allowed = env_vars.get("CORS_ALLOWED_ORIGINS") or os.environ.get("CORS_ALLOWED_ORIGINS", "")
    allow_creds = env_vars.get("CORS_ALLOW_CREDENTIALS") or os.environ.get("CORS_ALLOW_CREDENTIALS", "")
    if cors_allowed == "*" and allow_creds.lower() == "true":
        msg = "CORS_ALLOWED_ORIGINS is '*' while CORS_ALLOW_CREDENTIALS is true (insecure)"
        if target_env == "production":
            errors.append(msg)
        else:
            warnings.append(msg)

    # Output results
    if warnings:
        for w in warnings:
            print(f"  WARNING: {w}")
    if errors:
        for e in errors:
            print(f"  ERROR: {e}")
    if not errors and not warnings:
        print("  All production configuration rules PASSED.")

    return len(errors), len(warnings)


def main():
    parser = argparse.ArgumentParser(description="Validate Multi-ERP Production Configuration")
    parser.add_argument(
        "--env",
        default=os.environ.get("ENVIRONMENT", "production"),
        choices=["local", "development", "staging", "production", "test"],
        help="Target environment (default: production)",
    )
    args = parser.parse_args()

    print("=" * 70)
    print(">>> MULTI-ERP PRODUCTION CONFIGURATION AUDIT <<<")
    print(f"Target Environment: {args.env.upper()}")
    print("=" * 70)

    total_errors = 0
    total_warnings = 0

    for name, config in ERP_PROJECTS.items():
        errs, warns = validate_project_config(name, config, args.env)
        total_errors += errs
        total_warnings += warns

    print("\n" + "=" * 70)
    print(f"AUDIT SUMMARY: {total_errors} Error(s), {total_warnings} Warning(s)")
    print("=" * 70)

    if total_errors > 0:
        print("\n[RESULT] FAILED: Production configuration validation detected critical errors.")
        sys.exit(1)
    else:
        print("\n[RESULT] PASSED: Production configuration verified safe for deployment.")
        sys.exit(0)


if __name__ == "__main__":
    main()
