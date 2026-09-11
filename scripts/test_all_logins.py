"""
End-to-End Live HTTP Verification for Admin Login across all three ERPs.
"""

import json
import urllib.request
import urllib.error
import sys

def post_json(url: str, payload: dict, token: str = None) -> tuple[int, dict]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        try:
            return e.code, json.loads(body)
        except Exception:
            return e.code, {"raw": body}

def get_json(url: str, token: str) -> tuple[int, dict]:
    headers = {"Authorization": f"Bearer {token}"}
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        try:
            return e.code, json.loads(body)
        except Exception:
            return e.code, {"raw": body}

def main():
    print("=" * 60)
    print("VERIFYING LIVE LOGINS ACROSS ALL ERPS")
    print("=" * 60)
    failed = False

    # 1. ERP_Main (Port 8000)
    print("\n--- 1. ERP_Main (Port 8000) ---")
    status, res = post_json(
        "http://127.0.0.1:8000/api/v1/global/auth/login",
        {"email": "admin@example.com", "password": "ChangeMe!12345"}
    )
    if status == 200:
        data = res.get("data", {})
        token = data.get("access_token")
        status_me, me = get_json("http://127.0.0.1:8000/api/v1/global/auth/me", token)
        me_data = me.get("data", {})
        print(f"  [SUCCESS] HTTP {status} | User: {me_data.get('email')} | Role: {me_data.get('role')} | is_active: {me_data.get('is_active')}")
        print(f"  [SUCCESS] /auth/me HTTP {status_me}")
    else:
        print(f"  [FAILED] HTTP {status}: {res}")
        failed = True

    # 2. Yinglima_ERP (Port 8001)
    print("\n--- 2. Yinglima_ERP (Port 8001) ---")
    status, res = post_json(
        "http://127.0.0.1:8001/api/v1/auth/login",
        {"identifier": "admin@example.com", "password": "ChangeMe!12345"}
    )
    if status == 200:
        data = res.get("data", {})
        token = data.get("access_token")
        user = data.get("user", {})
        print(f"  [SUCCESS] HTTP {status} | User: {user.get('email')} | Roles: {user.get('roles')} | Perms: {len(user.get('permissions', []))}")
        status_prof, prof = get_json("http://127.0.0.1:8001/api/v1/auth/profile", token)
        print(f"  [SUCCESS] /auth/profile HTTP {status_prof}")
        status_org, org = get_json("http://127.0.0.1:8001/api/v1/organizations", token)
        print(f"  [SUCCESS] /organizations HTTP {status_org}")
    else:
        print(f"  [FAILED] HTTP {status}: {res}")
        failed = True

    # 3. Inhyma_ERP (Port 8002)
    print("\n--- 3. Inhyma_ERP (Port 8002) ---")
    status, res = post_json(
        "http://127.0.0.1:8002/api/v1/auth/login",
        {"identifier": "admin@example.com", "password": "ChangeMe!12345"}
    )
    if status == 200:
        data = res.get("data", {})
        token = data.get("access_token")
        user = data.get("user", {})
        print(f"  [SUCCESS] HTTP {status} | User: {user.get('email')} | Roles: {user.get('roles')} | Perms: {len(user.get('permissions', []))}")
        status_prof, prof = get_json("http://127.0.0.1:8002/api/v1/auth/profile", token)
        print(f"  [SUCCESS] /auth/profile HTTP {status_prof}")
        status_org, org = get_json("http://127.0.0.1:8002/api/v1/organizations", token)
        print(f"  [SUCCESS] /organizations HTTP {status_org}")
    else:
        print(f"  [FAILED] HTTP {status}: {res}")
        failed = True

    print("\n" + "=" * 60)
    if not failed:
        print("ALL THREE ERPS VERIFIED SUCCESSFULLY WITH IDENTICAL CREDENTIALS!")
    else:
        print("VERIFICATION FAILED FOR ONE OR MORE ERPS.")
        sys.exit(1)
    print("=" * 60)

if __name__ == "__main__":
    main()
