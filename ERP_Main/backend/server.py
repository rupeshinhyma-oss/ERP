"""
ERP_Main Development Server Entry Point.

Run with: `python server.py` (or `uvicorn app.main:app --reload` directly).
"""

from __future__ import annotations

import os
import uvicorn
from app.core.config import settings

if __name__ == "__main__":
    host = os.environ.get("HOST", settings.HOST)
    port = int(os.environ.get("PORT", settings.PORT))
    print(f"\n{'=' * 70}\n>>> Starting ERP_Main Control Plane API: http://{host}:{port}\n{'=' * 70}\n")
    uvicorn.run("app.main:app", host=host, port=port, reload=True)
