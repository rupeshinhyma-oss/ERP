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

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True)

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
RED = "\033[91m"

SERVICES = [
    {
        "name": "MAIN-API",
        "color": CYAN,
        "cwd": ROOT_DIR / "ERP_Main" / "backend",
        "cmd": [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload", "--reload-dir", "app"],
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
        "cmd": [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", "--reload", "--reload-dir", "app"],
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
        "cmd": [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002", "--reload", "--reload-dir", "app"],
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

# Startup readiness timeout (seconds)
BACKEND_HEALTH_TIMEOUT_SECONDS = int(os.environ.get("BACKEND_HEALTH_TIMEOUT_SECONDS", "90"))
BACKEND_HEALTH_POLL_INTERVAL_SECONDS = float(os.environ.get("BACKEND_HEALTH_POLL_INTERVAL_SECONDS", "0.5"))

processes: list[tuple[subprocess.Popen, dict]] = []
shutting_down = False


def kill_proc_tree(pid: int):
    """Recursively kill a process tree on Windows or POSIX."""
    if not pid:
        return
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True)
        else:
            os.killpg(os.getpgid(pid), signal.SIGKILL)
    except Exception:
        pass


def get_pid_for_port(port: int) -> int | None:
    """Find the process ID listening on a given TCP port on Windows."""
    try:
        if os.name == "nt":
            out = subprocess.check_output(["netstat", "-ano", "-p", "tcp"], text=True, errors="replace")
            for line in out.splitlines():
                parts = line.strip().split()
                if len(parts) >= 5 and parts[0] == "TCP" and parts[3] == "LISTENING":
                    local_addr = parts[1]
                    if local_addr.endswith(f":{port}"):
                        try:
                            pid = int(parts[4])
                            if pid > 0 and pid != os.getpid():
                                return pid
                        except ValueError:
                            pass
    except Exception:
        pass
    return None


def clean_port_if_occupied(port: int, verbose: bool = True) -> bool:
    """If port is occupied by an orphaned process, terminate it to prevent startup collisions."""
    pid = get_pid_for_port(port)
    if pid is not None and pid > 0 and pid != os.getpid():
        if verbose:
            print(f"{YELLOW}[RUNNER] Port {port} is occupied by orphaned PID {pid}. Cleaning up stale process...{RESET}", flush=True)
        kill_proc_tree(pid)
        time.sleep(0.6)
        return True
    return False


def resolve_service_cmd(svc: dict) -> list[str]:
    """
    Resolve the command to run for a service.
    If the service directory contains a self-bootstrapping runner (run.bat on Windows,
    run.sh on POSIX), delegates to it so that .env creation, .venv activation,
    dependency installation, and migrations are handled self-contained inside each ERP.
    Ensures backend APIs are invoked with --reload-dir app to avoid endless or spurious reload loops.
    """
    cwd = svc["cwd"]
    name = svc.get("name", "")
    url = svc.get("url", "")
    port = url.split(":")[-1] if ":" in url else None

    extra_args = []
    if name.endswith("-API") and port:
        extra_args = ["--host", "0.0.0.0", "--port", str(port), "--reload", "--reload-dir", "app"]

    if os.name == "nt":
        bat_file = cwd / "run.bat"
        if bat_file.exists():
            return ["cmd.exe", "/c", str(bat_file)] + extra_args
    else:
        sh_file = cwd / "run.sh"
        if sh_file.exists():
            return ["bash", str(sh_file)] + extra_args
    return svc["cmd"]


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


def wait_for_backend_health(
    name: str,
    health_url: str,
    proc: subprocess.Popen | None,
    color: str,
    timeout: float = BACKEND_HEALTH_TIMEOUT_SECONDS,
) -> bool:
    """
    Poll a backend's liveness endpoint until it responds or gives up.
    Immediately detects premature process termination without waiting for full timeout.
    """
    print(f"{color}[RUNNER] Waiting for {name} to become healthy...{RESET}", flush=True)
    start_time = time.monotonic()
    deadline = start_time + timeout

    while time.monotonic() < deadline:
        if shutting_down:
            return False

        # Fast-fail if the subprocess crashed or died during startup
        if proc is not None:
            code = proc.poll()
            if code is not None:
                elapsed = time.monotonic() - start_time
                print(
                    f"{RED}[ERROR] {name} process exited prematurely with exit code {code} "
                    f"after {elapsed:.1f}s. Check service logs above.{RESET}",
                    flush=True,
                )
                return False

        try:
            req = urllib.request.Request(
                health_url,
                headers={"User-Agent": "Multi-ERP-Runner/1.0"},
            )
            with urllib.request.urlopen(req, timeout=1.0) as response:
                if response.status == 200:
                    elapsed = time.monotonic() - start_time
                    print(
                        f"{color}[RUNNER] {name} is healthy (HTTP 200 in {elapsed:.1f}s).{RESET}",
                        flush=True,
                    )
                    return True
        except urllib.error.HTTPError:
            pass
        except (urllib.error.URLError, TimeoutError, OSError):
            pass

        time.sleep(BACKEND_HEALTH_POLL_INTERVAL_SECONDS)

    elapsed = time.monotonic() - start_time
    print(
        f"{YELLOW}[RUNNER] {name} did not respond at {health_url} within "
        f"{elapsed:.1f}s -- continuing anyway. Check service logs above.{RESET}",
        flush=True,
    )
    return False


def stream_logs(proc: subprocess.Popen, name: str, color: str):
    """Read lines from stdout and display them cleanly with service prefixes."""
    prefix = f"{color}[{name}]{RESET} "
    try:
        if proc.stdout is not None:
            for line in proc.stdout:
                if shutting_down:
                    break
                line = line.rstrip()
                if line:
                    print(f"{prefix}{line}", flush=True)
    except Exception:
        pass


def shutdown_all():
    """Gracefully terminate all running child services and clean up ports."""
    global shutting_down
    if shutting_down:
        return
    shutting_down = True
    print(f"\n{YELLOW}{BOLD}[RUNNER] Shutting down all 6 ecosystem services...{RESET}", flush=True)
    for p, svc in processes:
        if p.poll() is None:
            kill_proc_tree(p.pid)
    # Check ecosystem ports and ensure no orphaned child processes survive
    for svc in SERVICES:
        if svc.get("url"):
            try:
                port = int(svc["url"].split(":")[-1])
                clean_port_if_occupied(port, verbose=False)
            except Exception:
                pass
    print(f"{GREEN}{BOLD}[RUNNER] All services stopped cleanly.{RESET}\n", flush=True)


def run_in_terminal():
    print_banner()

    def sigint_handler(signum, frame):
        shutdown_all()
        sys.exit(0)

    # Register signal handlers immediately before launching any child processes
    signal.signal(signal.SIGINT, sigint_handler)
    signal.signal(signal.SIGTERM, sigint_handler)

    # Pre-flight check: ensure ecosystem ports are free of orphaned processes
    for svc in SERVICES:
        if svc.get("url"):
            try:
                port = int(svc["url"].split(":")[-1])
                clean_port_if_occupied(port, verbose=True)
            except Exception:
                pass

    launched_backends: dict[str, tuple[subprocess.Popen, dict]] = {}

    try:
        for svc in SERVICES:
            if shutting_down:
                break

            if not svc["cwd"].exists():
                print(f"{YELLOW}[WARN] Directory {svc['cwd']} does not exist, skipping {svc['name']}.{RESET}", flush=True)
                continue

            # Wait for paired backend health before launching frontend
            wait_for_name = svc.get("wait_for")
            if wait_for_name and wait_for_name in launched_backends:
                b_proc, b_svc = launched_backends[wait_for_name]
                wait_for_backend_health(wait_for_name, b_svc["health_url"], b_proc, svc["color"])

            if shutting_down:
                break

            cmd_to_run = resolve_service_cmd(svc)
            env = os.environ.copy()
            env["PYTHONUNBUFFERED"] = "1"
            try:
                proc = subprocess.Popen(
                    cmd_to_run,
                    cwd=str(svc["cwd"]),
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    bufsize=1,
                    env=env,
                )
                processes.append((proc, svc))
                t = threading.Thread(target=stream_logs, args=(proc, svc["name"], svc["color"]), daemon=True)
                t.start()
                if svc.get("health_url"):
                    launched_backends[svc["name"]] = (proc, svc)
                time.sleep(0.3)
            except Exception as e:
                print(f"{RED}[ERROR] Failed to start {svc['name']}: {e}{RESET}", flush=True)

        # After launching the final frontend (INHYMA-UI), ensure INHYMA-API is verified healthy
        if "INHYMA-API" in launched_backends and not shutting_down:
            inh_proc, inh_svc = launched_backends["INHYMA-API"]
            wait_for_backend_health("INHYMA-API", inh_svc["health_url"], inh_proc, inh_svc["color"])

        print(f"\n{GREEN}{BOLD}[RUNNER] All 6 ecosystem services started successfully!{RESET}\n", flush=True)

        reported_exits = set()
        while not shutting_down:
            time.sleep(1)
            # Check if any process died unexpectedly
            for p, svc in processes:
                code = p.poll()
                if code is not None and not shutting_down and svc["name"] not in reported_exits:
                    reported_exits.add(svc["name"])
                    print(f"{svc['color']}[{svc['name']}] Exited with code {code}{RESET}", flush=True)
                    if code != 0 and svc.get("url"):
                        try:
                            port = int(svc["url"].split(":")[-1])
                            print(f"{YELLOW}[RUNNER] {svc['name']} exited with code {code}. (If port {port} is occupied, it will be automatically cleaned on restart.){RESET}", flush=True)
                        except Exception:
                            pass
    except KeyboardInterrupt:
        shutdown_all()
        sys.exit(0)


def run_in_windows():
    print_banner()
    print(f"{GREEN}Launching 6 separate CMD windows for each service...{RESET}\n")

    # Clean ports before opening external windows
    for svc in SERVICES:
        if svc.get("url"):
            try:
                port = int(svc["url"].split(":")[-1])
                clean_port_if_occupied(port, verbose=True)
            except Exception:
                pass

    launched_health_urls: dict[str, str] = {}

    for svc in SERVICES:
        if not svc["cwd"].exists():
            continue

        wait_for_name = svc.get("wait_for")
        if wait_for_name and wait_for_name in launched_health_urls:
            wait_for_backend_health(wait_for_name, launched_health_urls[wait_for_name], None, svc["color"])

        cmd_list = resolve_service_cmd(svc)
        cmd_str = " ".join(f'"{c}"' if " " in c else c for c in cmd_list)
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