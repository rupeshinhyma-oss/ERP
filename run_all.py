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
        "url": "http://localhost:8000",
    },
    {
        "name": "MAIN-UI",
        "color": BLUE,
        "cwd": ROOT_DIR / "ERP_Main" / "frontend",
        "cmd": ["cmd.exe", "/c", "npm", "run", "dev"],
        "url": "http://localhost:5170",
    },
    {
        "name": "YINGLIMA-API",
        "color": GREEN,
        "cwd": ROOT_DIR / "Yinglima_ERP" / "backend",
        "cmd": [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", "--reload"],
        "url": "http://localhost:8001",
    },
    {
        "name": "YINGLIMA-UI",
        "color": YELLOW,
        "cwd": ROOT_DIR / "Yinglima_ERP" / "frontend",
        "cmd": ["cmd.exe", "/c", "npm", "run", "dev"],
        "url": "http://localhost:5173",
    },
    {
        "name": "INHYMA-API",
        "color": MAGENTA,
        "cwd": ROOT_DIR / "Inhyma_ERP" / "backend",
        "cmd": [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002", "--reload"],
        "url": "http://localhost:8002",
    },
    {
        "name": "INHYMA-UI",
        "color": WHITE,
        "cwd": ROOT_DIR / "Inhyma_ERP" / "frontend",
        "cmd": ["cmd.exe", "/c", "npm", "run", "dev"],
        "url": "http://localhost:5174",
    },
]

processes = []
shutting_down = False


def print_banner():
    print(f"""{BOLD}{CYAN}
================================================================================
>>> MULTI-ERP ECOSYSTEM MASTER RUNNER <<<
================================================================================{RESET}
  {BOLD}ERP_Main Control Plane:{RESET}
    - Frontend UI:  {CYAN}http://localhost:5170{RESET}
    - Backend API:  {CYAN}http://localhost:8000{RESET} (Docs: /docs)

  {BOLD}Yinglima ERP (China Procurement):{RESET}
    - Frontend UI:  {YELLOW}http://localhost:5173{RESET}
    - Backend API:  {GREEN}http://localhost:8001{RESET} (Docs: /docs)

  {BOLD}Inhyma ERP (India Distribution):{RESET}
    - Frontend UI:  {WHITE}http://localhost:5174{RESET}
    - Backend API:  {MAGENTA}http://localhost:8002{RESET} (Docs: /docs)

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

    # Pre-flight check: ensure npm and python are callable
    for svc in SERVICES:
        if not svc["cwd"].exists():
            print(f"{YELLOW}[WARN] Directory {svc['cwd']} does not exist, skipping {svc['name']}.{RESET}")
            continue

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

    for svc in SERVICES:
        if not svc["cwd"].exists():
            continue
        cmd_str = " ".join(f'"{c}"' if " " in c else c for c in svc["cmd"])
        full_cmd = f'start "{svc["name"]} ({svc["url"]})" cmd /k "cd /d "{svc["cwd"]}" && {cmd_str}"'
        subprocess.run(full_cmd, shell=True)
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
