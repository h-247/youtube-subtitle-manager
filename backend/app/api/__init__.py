from fastapi import APIRouter
from app.api.auth import router as auth_router
from app.api.videos import router as videos_router
from app.api.drive import router as drive_router
from app.api.sites import router as sites_router
from app.api.sites_sync import router as sites_sync_router

api_router = APIRouter(prefix="/api")
api_router.include_router(auth_router)
api_router.include_router(videos_router)
api_router.include_router(drive_router)
api_router.include_router(sites_router)
api_router.include_router(sites_sync_router)

__all__ = ["api_router"]
