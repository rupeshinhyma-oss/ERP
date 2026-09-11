"""
One-command backend startup for ERP_Main Global Control Plane.

Usage:
    python server.py

Runs, in order:
    1. alembic upgrade head   -- applies any pending database migrations
    2. python -m scripts.seed  -- idempotent bootstrap (registry, platform authz,
                                   bootstrap platform admin, global user)
    3. uvicorn app.main:app    -- starts the API server

Configuration (host/port/reload) can be overridden via environment
variables or command-line flags -- see `python server.py --help`.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent


def _run_step(description: str, command: list[str]) -> None:
    """Run one setup step, streaming its output live, and abort on failure."""
    print(f"\n{'=' * 70}\n>>> {description}\n{'=' * 70}")
    result = subprocess.run(command, cwd=BACKEND_DIR)
    if result.returncode != 0:
        print(
            f"\n[server.py] ERROR: step failed ({description!r}, exit code "
            f"{result.returncode}). Aborting startup -- fix the error above and "
            "re-run `python server.py`."
        )
        sys.exit(result.returncode)


def _check_env_file() -> None:
    """Warn (but don't block) if .env is missing."""
    env_path = BACKEND_DIR / ".env"
    if not env_path.exists():
        print(
            "\n[server.py] WARNING: no .env file found at "
            f"{env_path}. If you haven't already, copy .env.example to .env "
            "and fill in your real DATABASE_URL / PLATFORM_JWT_SECRET_KEY / etc. "
            "before continuing.\n"
        )


def _ensure_venv() -> None:
    """If running outside a virtual environment, re-exec with local venv python if found."""
    if sys.prefix != sys.base_prefix or hasattr(sys, "real_prefix"):
        return

    for venv_name in ("venv", ".venv", "env"):
        candidate = (
            BACKEND_DIR / venv_name / "Scripts" / "python.exe"
            if sys.platform == "win32"
            else BACKEND_DIR / venv_name / "bin" / "python"
        )
        if candidate.is_file():
            print(f"[server.py] Auto-switching to detected virtual environment at '{venv_name}':\n  {candidate}\n")
            result = subprocess.run([str(candidate), str(Path(__file__).resolve()), *sys.argv[1:]], cwd=BACKEND_DIR)
            sys.exit(result.returncode)

    # If no local venv in ERP_Main, check if a workspace sibling .venv exists (e.g. Yinglima_ERP/.venv)
    sibling_candidate = (
        BACKEND_DIR.parent.parent / "Yinglima_ERP" / "backend" / ".venv" / "Scripts" / "python.exe"
        if sys.platform == "win32"
        else BACKEND_DIR.parent.parent / "Yinglima_ERP" / "backend" / ".venv" / "bin" / "python"
    )
    if sibling_candidate.is_file():
        try:
            import fastapi, uvicorn, alembic  # noqa
        except ImportError:
            print(f"[server.py] Auto-switching to shared virtual environment:\n  {sibling_candidate}\n")
            result = subprocess.run([str(sibling_candidate), str(Path(__file__).resolve()), *sys.argv[1:]], cwd=BACKEND_DIR)
            sys.exit(result.returncode)


def main() -> None:
    """Parse CLI flags, run migrations + seed, then hand off to uvicorn."""
    _ensure_venv()
    parser = argparse.ArgumentParser(description="Run migrations, seed data, then start the ERP_Main API server.")
    parser.add_argument("--host", default="0.0.0.0", help="Host/interface to bind uvicorn to (default: 0.0.0.0).")
    default_port = int(os.environ.get("PORT", 8000))
    parser.add_argument("--port", type=int, default=default_port, help=f"Port to bind uvicorn to (default: {default_port}).")
    parser.add_argument(
        "--no-reload", action="store_true", help="Disable uvicorn's auto-reload (default: reload is ON)."
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=1,
        help="Number of Uvicorn worker processes (default: 1).",
    )
    parser.add_argument(
        "--skip-migrate", action="store_true", help="Skip the 'alembic upgrade head' step."
    )
    parser.add_argument(
        "--skip-seed", action="store_true", help="Skip the 'python -m scripts.seed' step."
    )
    args = parser.parse_args()

    _check_env_file()

    python = str(Path(sys.executable).resolve())

    if not args.skip_migrate:
        _run_step("Applying database migrations (alembic upgrade head)", [python, "-m", "alembic", "upgrade", "head"])
    else:
        print("\n[server.py] Skipping migrations (--skip-migrate).")

    if not args.skip_seed:
        _run_step("Seeding bootstrap data (registry, platform authz, admin)", [python, "-m", "scripts.seed"])
    else:
        print("\n[server.py] Skipping seed step (--skip-seed).")

    uvicorn_command = [
        python, "-m", "uvicorn", "app.main:app",
        "--host", args.host,
        "--port", str(args.port),
    ]
    if not args.no_reload:
        uvicorn_command.append("--reload")
        if args.workers > 1:
            print(
                "\n[server.py] WARNING: --reload is on, so --workers is being "
                "ignored (forced to 1). Pass --no-reload --workers "
                f"{args.workers} together to run multiple workers.\n"
            )
    elif args.workers > 1:
        uvicorn_command.extend(["--workers", str(args.workers)])

    print(f"\n{'=' * 70}\n>>> Starting ERP_Main Control Plane API: http://{args.host}:{args.port}\n{'=' * 70}\n")
    result = subprocess.run(uvicorn_command, cwd=BACKEND_DIR)
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
