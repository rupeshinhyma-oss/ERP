"""
Health Routes.

A basic liveness check for ERP_Main itself -- separate from the ERP
Registry's `last_seen_at` field (Phase 2 Step 12), which is about tracking
the health of OTHER ERP instances, not this control-plane service's own.
"""

from __future__ import annotations

from fastapi import APIRouter, Request

from app.core.responses import build_success_response

router = APIRouter(prefix="/health", tags=["Health"])


@router.get("", summary="Liveness check")
async def health(request: Request) -> dict:
    """Return a simple liveness confirmation for ERP_Main."""
    request_id = getattr(request.state, "request_id", "")
    return build_success_response({"status": "ok"}, request_id=request_id)
