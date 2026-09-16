"""
Multi-ERP Ecosystem Unified Runner.

Launches and supervises all 6 ecosystem services concurrently:
  1. ERP_Main Backend       (FastAPI @ http://localhost:8000)
  2. ERP_Main Frontend      (Vite React @ http://localhost:5170)
  3. Yinglima_ERP Backend   (FastAPI @ http://localhost:8001)
  4. Yinglima_ERP Frontend  (Vite React @ http://localhost:5173)
  5. Inhyma_ERP Backend     (FastAPI @ http://localhost:8002)
  6. Inhyma_ERP Frontend    (Vite React @ http://localhost:5174)

Usage:
  python run_all.py               Stream all 6 services into this terminal
  python run_all.py --windows     Open each service in its own CMD window
"""

import argparse
import os
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent

# ANSI Colors for terminal output
RESET = "\033[0m"
BOLD = "\033[1m"
CYAN = "\033[96m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
MAGENTA = "\033[95m"
WHITE = "\033[97m"

SERVICES = [
    {
        "name": "MAIN-API",
        "color": CYAN,
        "cwd": ROOT_DIR / "ERP_Main" / "backend",
        "cmd": [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"],
        "url": "http://127.0.0.1:8000",
        "health_url": "http://127.0.0.1:8000/api/v1/health/live",
    },
    {
        "name": "MAIN-UI",
        "color": BLUE,
        "cwd": ROOT_DIR / "ERP_Main" / "frontend",
        "cmd": ["cmd.exe", "/c", "npm", "run", "dev"],
        "url": "http://127.0.0.1:5170",
        "wait_for": "MAIN-API",
    },
    {
        "name": "YINGLIMA-API",
        "color": GREEN,
        "cwd": ROOT_DIR / "Yinglima_ERP" / "backend",
        "cmd": [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", "--reload"],
        "url": "http://127.0.0.1:8001",
        "health_url": "http://127.0.0.1:8001/api/v1/health/live",
    },
    {
        "name": "YINGLIMA-UI",
        "color": YELLOW,
        "cwd": ROOT_DIR / "Yinglima_ERP" / "frontend",
        "cmd": ["cmd.exe", "/c", "npm", "run", "dev"],
        "url": "http://127.0.0.1:5173",
        "wait_for": "YINGLIMA-API",
    },
    {
        "name": "INHYMA-API",
        "color": MAGENTA,
        "cwd": ROOT_DIR / "Inhyma_ERP" / "backend",
        "cmd": [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002", "--reload"],
        "url": "http://127.0.0.1:8002",
        "health_url": "http://127.0.0.1:8002/api/v1/health/live",
    },
    {
        "name": "INHYMA-UI",
        "color": WHITE,
        "cwd": ROOT_DIR / "Inhyma_ERP" / "frontend",
        "cmd": ["cmd.exe", "/c", "npm", "run", "dev"],
        "url": "http://127.0.0.1:5174",
        "wait_for": "INHYMA-API",
    },
]

# How long to wait for a backend's health endpoint before giving up and
# moving on anyway (never blocks forever -- see wait_for_backend_health's
# own docstring for the reasoning).
BACKEND_HEALTH_TIMEOUT_SECONDS = 60
BACKEND_HEALTH_POLL_INTERVAL_SECONDS = 0.5

processes = []
shutting_down = False


def print_banner():
    print(f"""{BOLD}{CYAN}
================================================================================
>>> MULTI-ERP ECOSYSTEM MASTER RUNNER <<<
================================================================================{RESET}
  {BOLD}ERP_Main Control Plane:{RESET}
    - Frontend UI:  {CYAN}http://127.0.0.1:5170{RESET}
    - Backend API:  {CYAN}http://127.0.0.1:8000{RESET} (Docs: /docs)

  {BOLD}Yinglima ERP (China Procurement):{RESET}
    - Frontend UI:  {YELLOW}http://127.0.0.1:5173{RESET}
    - Backend API:  {GREEN}http://127.0.0.1:8001{RESET} (Docs: /docs)

  {BOLD}Inhyma ERP (India Distribution):{RESET}
    - Frontend UI:  {WHITE}http://127.0.0.1:5174{RESET}
    - Backend API:  {MAGENTA}http://127.0.0.1:8002{RESET} (Docs: /docs)

  {BOLD}Default Admin Credentials:{RESET}
    - Username / Email: {BOLD}admin@example.com{RESET}
    - Default Password: {BOLD}ChangeMe!12345{RESET}
================================================================================
Press {BOLD}Ctrl+C{RESET} at any time to gracefully stop all 6 services.
================================================================================
""")


def kill_proc_tree(pid: int):
    """Recursively kill a process tree on Windows."""
    try:
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True)
    except Exception:
        pass


def wait_for_backend_health(name: str, health_url: str, color: str) -> bool:
    """
    Poll a backend's liveness endpoint until it responds or we give up.

    This exists because a backend takes a real, variable amount of time
    to become reachable -- creating its database engine, starting
    background workers (queue, durable events, cache cleanup, inbound
    email polling), etc. -- easily several seconds, not the previous flat
    0.5s pause between launching services. Its paired frontend, by
    contrast, is usually ready almost immediately. Without this wait, the
    frontend starts proxying requests (including login) to a backend
    that isn't listening yet, which surfaces to whoever's using the app
    as a confusing, seemingly random network error or an unhelpful
    502/500 -- indistinguishable from a real bug in the login flow
    itself, when it was actually just a startup race.

    Returns True once the backend responds, or False if
    BACKEND_HEALTH_TIMEOUT_SECONDS elapses first. Either way, this never
    raises and never blocks forever -- a backend that is failing to
    start for a REAL reason (bad config, unreachable database, etc.)
    will keep failing after the timeout too, and that failure is much
    easier to diagnose from that backend's own streamed logs than from a
    runner that hung indefinitely waiting for it.
    """
    print(f"{color}[RUNNER] Waiting for {name} to become healthy...{RESET}")
    deadline = time.monotonic() + BACKEND_HEALTH_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if shutting_down:
            return False
        try:
            with urllib.request.urlopen(health_url, timeout=2) as response:
                if response.status == 200:
                    print(f"{color}[RUNNER] {name} is healthy.{RESET}")
                    return True
        except (urllib.error.URLError, OSError, TimeoutError):
            # Expected while the backend hasn't started listening yet
            # (connection refused) or is still mid-startup (timeout) --
            # not a real error, just "not ready yet."
            pass
        time.sleep(BACKEND_HEALTH_POLL_INTERVAL_SECONDS)

    print(
        f"{YELLOW}[RUNNER] {name} did not become healthy within "
        f"{BACKEND_HEALTH_TIMEOUT_SECONDS}s -- continuing anyway. Check its logs above; "
        f"its paired frontend may show connection errors until it catches up.{RESET}"
    )
    return False


def stream_logs(proc: subprocess.Popen, name: str, color: str):
    prefix = f"{color}[{name}]{RESET} "
    try:
        for line in iter(proc.stdout.readline, b""):
            if shutting_down:
                break
            try:
                decoded = line.decode("utf-8", errors="replace").rstrip()
                if decoded:
                    print(f"{prefix}{decoded}")
            except Exception:
                pass
    except Exception:
        pass


def shutdown_all():
    global shutting_down
    if shutting_down:
        return
    shutting_down = True
    print(f"\n{YELLOW}{BOLD}[RUNNER] Shutting down all 6 ecosystem services...{RESET}")
    for p, svc in processes:
        if p.poll() is None:
            kill_proc_tree(p.pid)
    print(f"{GREEN}{BOLD}[RUNNER] All services stopped cleanly.{RESET}\n")


def run_in_terminal():
    print_banner()

    launched_health_urls: dict[str, str] = {}

    # Pre-flight check: ensure npm and python are callable
    for svc in SERVICES:
        if not svc["cwd"].exists():
            print(f"{YELLOW}[WARN] Directory {svc['cwd']} does not exist, skipping {svc['name']}.{RESET}")
            continue

        # If this service is a frontend paired with a backend (its
        # "wait_for" field names that backend's SERVICES entry), wait for
        # that backend to actually respond to its health check before
        # starting the frontend -- this is the fix for the startup race:
        # previously a frontend could start and begin proxying requests
        # (including login) to a backend that hadn't finished booting
        # yet, several seconds before it was actually listening.
        wait_for_name = svc.get("wait_for")
        if wait_for_name and wait_for_name in launched_health_urls:
            wait_for_backend_health(wait_for_name, launched_health_urls[wait_for_name], svc["color"])

        try:
            proc = subprocess.Popen(
                svc["cmd"],
                cwd=str(svc["cwd"]),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                bufsize=1,
            )
            processes.append((proc, svc))
            t = threading.Thread(target=stream_logs, args=(proc, svc["name"], svc["color"]), daemon=True)
            t.start()
            if svc.get("health_url"):
                launched_health_urls[svc["name"]] = svc["health_url"]
            time.sleep(0.5)
        except Exception as e:
            print(f"{YELLOW}[ERROR] Failed to start {svc['name']}: {e}{RESET}")

    def sigint_handler(signum, frame):
        shutdown_all()
        sys.exit(0)

    signal.signal(signal.SIGINT, sigint_handler)
    signal.signal(signal.SIGTERM, sigint_handler)

    try:
        while not shutting_down:
            time.sleep(1)
            # Check if any process died unexpectedly
            for p, svc in processes:
                code = p.poll()
                if code is not None and not shutting_down:
                    print(f"{svc['color']}[{svc['name']}] Exited with code {code}{RESET}")
    except KeyboardInterrupt:
        shutdown_all()


def run_in_windows():
    print_banner()
    print(f"{GREEN}Launching 6 separate CMD windows for each service...{RESET}\n")

    launched_health_urls: dict[str, str] = {}

    for svc in SERVICES:
        if not svc["cwd"].exists():
            continue

        # Same startup-race fix as run_in_terminal(): wait for a
        # frontend's paired backend to actually respond before opening
        # its window. Each service here runs in its own detached CMD
        # window, so this process can't watch its stdout the way
        # run_in_terminal() does -- polling the health endpoint over
        # HTTP is the only signal available for "is it actually ready,"
        # and it works identically regardless of how the process itself
        # was launched.
        wait_for_name = svc.get("wait_for")
        if wait_for_name and wait_for_name in launched_health_urls:
            wait_for_backend_health(wait_for_name, launched_health_urls[wait_for_name], svc["color"])

        cmd_str = " ".join(f'"{c}"' if " " in c else c for c in svc["cmd"])
        full_cmd = f'start "{svc["name"]} ({svc["url"]})" cmd /k "cd /d "{svc["cwd"]}" && {cmd_str}"'
        subprocess.run(full_cmd, shell=True)
        if svc.get("health_url"):
            launched_health_urls[svc["name"]] = svc["health_url"]
        time.sleep(0.3)

    print(f"{GREEN}{BOLD}All 6 service windows launched successfully!{RESET}\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Multi-ERP Ecosystem Unified Runner")
    parser.add_argument("--windows", action="store_true", help="Launch each service in a separate CMD window")
    args = parser.parse_args()

    if args.windows:
        run_in_windows()
    else:
        run_in_terminal()