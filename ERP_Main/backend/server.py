"""
ERP_Main Development Server Entry Point.

Run with: `python server.py` (or `uvicorn app.main:app --reload` directly).
"""

from __future__ import annotations

import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8100, reload=True)
