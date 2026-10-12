"""System Backup Routes."""

from __future__ import annotations

from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse

from app.auth.dependencies import get_current_user
from app.auth.service import CurrentUser
from app.core.backup_service import BACKUP_DIR, backup_service
from app.core.responses import build_success_response
from app.rbac.dependencies import require_permission

router = APIRouter(prefix="/system/backups", tags=["System - Backup"])


@router.get("", summary="List system database backups")
async def list_backups(
    request: Request,
    current_user: CurrentUser = Depends(require_permission("system.view")),
) -> dict:
    """Return all database backups created automatically at 8:00 PM or manually."""
    backups = backup_service.list_backups()
    return build_success_response(data={"backups": backups}, request_id=request.state.request_id)


@router.post("", summary="Trigger database backup manually")
async def trigger_backup(
    request: Request,
    current_user: CurrentUser = Depends(require_permission("system.manage")),
) -> dict:
    """Trigger an immediate database backup and save to uploads/backups/."""
    result = backup_service.create_backup(reason=f"manual_by_{current_user.username}")
    return build_success_response(data=result, request_id=request.state.request_id)


@router.get("/{filename}", summary="Download backup file")
async def download_backup(
    filename: str,
    current_user: CurrentUser = Depends(require_permission("system.manage")),
) -> FileResponse:
    """Download a specific backup file."""
    clean_name = Path(filename).name
    file_path = BACKUP_DIR / clean_name
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Backup file not found")

    return FileResponse(
        path=str(file_path),
        filename=clean_name,
        media_type="application/octet-stream",
    )
