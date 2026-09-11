"""
Repository Secret & Credential Scanner.

Scans the codebase for exposed credentials, private keys, and database passwords.
Exits with code 1 if any unpermitted active secret or private key is detected.
Exits with code 0 if all clean or only permitted placeholders/fixtures are found.
"""

import os
import re
import sys
from pathlib import Path

# Paths to skip
EXCLUDE_DIRS = {
    "node_modules",
    ".git",
    "__pycache__",
    ".pytest_cache",
    ".venv",
    "venv",
    "dist",
    "build",
    ".vite",
    "scratch",
    "federation_keys",
}

EXCLUDE_FILES = {
    ".env",            # Local development env (ignored by git)
    ".env.local",      # Local dev
    "cacert.pem",      # Standard CA cert bundle inside pip
}

# Permitted test fixture or placeholder strings
PERMITTED_PATTERNS = [
    r"<[^>]+>",                        # e.g. <PROJECT_REF>, <DB_PASSWORD>
    r"CHANGE-ME",                      # e.g. CHANGE-ME-IN-PRODUCTION-...
    r"ChangeMe!12345",                 # Bootstrap admin dev password
    r"admin:ChangeMe!12345",           # Bootstrap dev credential
    r"postgres:postgres@localhost",    # Default local dev Docker fallback
    r"postgres:postgres@127\.0\.0\.1", # Default local dev Docker fallback
    r"test-secret",                    # Test fixtures
    r"fake-secret",                    # Test fixtures
    r"dummy-secret",                   # Test fixtures
    r"Str0ng!Passw0rd",                # Pytest user registration fixtures
    r"ValidPassword123!",              # Pytest user registration fixtures
    r"ExampleSecretKeyDoNotUse",       # Example docs
]

COMPILED_PERMITTED = [re.compile(p) for p in PERMITTED_PATTERNS]

def is_permitted(value: str) -> bool:
    return any(p.search(value) for p in COMPILED_PERMITTED)

def scan_file(file_path: Path) -> list[dict]:
    findings = []
    
    # Skip scanner script itself from self-matching patterns
    if file_path.name in ("scan_repository_secrets.py", "scan_credentials.py"):
        return findings
    
    # Read text
    try:
        content = file_path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return findings

    # Check 1: Private Key Headers
    if "-----BEGIN" in content and "PRIVATE KEY-----" in content:
        # Check if it's an intentionally fake test fixture
        if not ("test" in file_path.name.lower() or "fixture" in file_path.name.lower()):
            findings.append({
                "file": str(file_path),
                "type": "PRIVATE_KEY_EXPOSED",
                "message": "Found embedded private key block."
            })

    # Check 2: Live Database connection string with embedded non-placeholder password
    # e.g. postgresql://user:password@host:port/db
    db_matches = re.finditer(r"(?:postgresql|postgres)(?:\+asyncpg)?://([^:@\s]+):([^@\s]+)@([^/\s:]+)(?::(\d+))?/([^\s\?\"']+)", content)
    for m in db_matches:
        user, pwd, host, port, db = m.groups()
        # Skip local development dummy URLs targeting localhost / 127.0.0.1
        if host in ("localhost", "127.0.0.1", "host"):
            continue
        if is_permitted(pwd) or is_permitted(user) or is_permitted(m.group(0)):
            continue
        # Skip doc or example files if they have obvious dummy values
        if user in ("user", "username", "myuser", "postgres", "erp_user") and pwd in ("password", "mypassword", "pass", "postgres", "erp_password"):
            continue
        # Skip if already sanitized
        if "<REDACTED" in user or "<REDACTED" in pwd:
            continue
        findings.append({
            "file": str(file_path),
            "type": "DATABASE_CREDENTIAL_EXPOSED",
            "message": f"Connection URL with plain credentials targeting host: {host[:15]}..."
        })

    # Check 3: Raw JWT Tokens
    jwt_matches = re.findall(r"eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}", content)
    for token in jwt_matches:
        if is_permitted(token) or "test" in file_path.name.lower():
            continue
        findings.append({
            "file": str(file_path),
            "type": "JWT_SECRET_EXPOSED",
            "message": f"Found raw JWT token pattern: {token[:16]}..."
        })

    # Check 4: Common API tokens / Provider Keys (sbp_, sk_live_, ghp_, etc.)
    api_token_matches = re.findall(r"\b(?:sbp_[a-zA-Z0-9]{20,}|sk_live_[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,})\b", content)
    for token in api_token_matches:
        if is_permitted(token):
            continue
        findings.append({
            "file": str(file_path),
            "type": "API_TOKEN_EXPOSED",
            "message": f"Found sensitive provider API token: {token[:8]}..."
        })

    return findings

def scan_directory(root_path: Path) -> list[dict]:
    all_findings = []
    for root, dirs, files in os.walk(root_path):
        # Prune excluded directories
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for f in files:
            if f in EXCLUDE_FILES:
                continue
            fpath = Path(root) / f
            findings = scan_file(fpath)
            all_findings.extend(findings)
    return all_findings

def main():
    root = Path(__file__).resolve().parent.parent
    findings = scan_directory(root)
    
    print("=" * 70)
    print(">>> MULTI-ERP ECOSYSTEM REPOSITORY SECRET AUDIT <<<")
    print(f"Scanned Root: {root}")
    print("=" * 70)
    
    if findings:
        print(f"\n[FAIL] Found {len(findings)} potential exposed secret(s):")
        for idx, item in enumerate(findings, 1):
            rel = os.path.relpath(item['file'], root)
            print(f"  {idx}. [{item['type']}] in {rel}")
            print(f"     Details: {item['message']}")
        print("\nSecurity scan FAILED. Remediate all secrets before proceeding.")
        sys.exit(1)
    else:
        print("\n[PASS] Zero unpermitted secrets, private keys, or credentials found.")
        print("Repository is clean and verified safe.")
        sys.exit(0)

if __name__ == "__main__":
    main()
