"""Purchase router: Local and Import purchases."""

from fastapi import APIRouter

from app.purchase.import_routes import router as import_router
from app.purchase.local_routes import router as local_router

router = APIRouter()
router.include_router(local_router)
router.include_router(import_router)
