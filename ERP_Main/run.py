"""
ERP_Main - Global Control Plane Standalone Runner.
Launches and supervises backend and frontend services for ERP_Main.

Usage:
  python run.py               Stream both services into this terminal
  python run.py --windows     Open each service in its own CMD window
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

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True)

ROOT_DIR = Path(__file__).resolve().parent

RESET = "\033[0m"
BOLD = "\033[1m"
CYAN = "\033[96m"
BLUE = "\033[94m"
YELLOW = "\033[93m"
GREEN = "\033[92m"

SERVICES = [
    {
        "name": "MAIN-API",
        "color": CYAN,
        "cwd": ROOT_DIR / "backend",
        "cmd": ["cmd.exe", "/c", "run.bat"] if os.name == "nt" else ["bash", "run.sh"],
        "url": "http://127.0.0.1:8000",
        "health_url": "http://127.0.0.1:8000/api/v1/health/live",
    },
    {
        "name": "MAIN-UI",
        "color": BLUE,
        "cwd": ROOT_DIR / "frontend",
        "cmd": ["cmd.exe", "/c", "run.bat"] if os.name == "nt" else ["bash", "run.sh"],
        "url": "http://127.0.0.1:5170",
        "wait_for": "MAIN-API",
    },
]

BACKEND_HEALTH_TIMEOUT_SECONDS = 180
BACKEND_HEALTH_POLL_INTERVAL_SECONDS = 0.5

processes = []
shutting_down = False


def print_banner():
    print(f"""{BOLD}{CYAN}
================================================================================
>>> ERP_MAIN - GLOBAL CONTROL PLANE STANDALONE RUNNER <<<
================================================================================{RESET}
  Frontend UI: {CYAN}http://127.0.0.1:5170{RESET}
  Backend API: {CYAN}http://127.0.0.1:8000{RESET} (Docs: /docs)

  Default Admin Credentials:
    - Email:    {BOLD}admin@example.com{RESET}
    - Password: {BOLD}ChangeMe!12345{RESET}
================================================================================
Press {BOLD}Ctrl+C{RESET} at any time to gracefully stop all services.
================================================================================
""")


def kill_proc_tree(pid: int):
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True)
        else:
            os.killpg(os.getpgid(pid), signal.SIGTERM)
    except Exception:
        pass


def wait_for_backend_health(name: str, health_url: str, color: str) -> bool:
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
            pass
        time.sleep(BACKEND_HEALTH_POLL_INTERVAL_SECONDS)
    print(f"{YELLOW}[RUNNER] {name} did not respond within {BACKEND_HEALTH_TIMEOUT_SECONDS}s, continuing...{RESET}")
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
    print(f"\n{YELLOW}{BOLD}[RUNNER] Stopping ERP_Main services...{RESET}")
    for p, svc in processes:
        if p.poll() is None:
            kill_proc_tree(p.pid)
    print(f"{GREEN}{BOLD}[RUNNER] All services stopped cleanly.{RESET}\n")


def run_in_terminal():
    print_banner()
    launched_health_urls = {}

    for svc in SERVICES:
        if not svc["cwd"].exists():
            continue

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
            for p, svc in processes:
                code = p.poll()
                if code is not None and not shutting_down:
                    print(f"{svc['color']}[{svc['name']}] Exited with code {code}{RESET}")
    except KeyboardInterrupt:
        shutdown_all()


def run_in_windows():
    print_banner()
    print(f"{GREEN}Launching separate CMD windows for each service...{RESET}\n")
    launched_health_urls = {}

    for svc in SERVICES:
        if not svc["cwd"].exists():
            continue

        wait_for_name = svc.get("wait_for")
        if wait_for_name and wait_for_name in launched_health_urls:
            wait_for_backend_health(wait_for_name, launched_health_urls[wait_for_name], svc["color"])

        cmd_str = " ".join(f'"{c}"' if " " in c else c for c in svc["cmd"])
        full_cmd = f'start "{svc["name"]} ({svc["url"]})" cmd /k "cd /d "{svc["cwd"]}" && {cmd_str}"'
        subprocess.run(full_cmd, shell=True)
        if svc.get("health_url"):
            launched_health_urls[svc["name"]] = svc["health_url"]
        time.sleep(0.3)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ERP_Main Standalone Runner")
    parser.add_argument("--windows", action="store_true", help="Launch each service in a separate CMD window")
    args = parser.parse_args()

    if args.windows:
        run_in_windows()
    else:
        run_in_terminal()
