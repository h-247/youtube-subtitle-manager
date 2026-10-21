from fastapi import APIRouter, Depends
from app.api.deps import get_current_user
from app.models.user import User
from app.services.youtube_playlist_service import get_youtube_status, retry_playlist_removals, disconnect_youtube
router = APIRouter(prefix="/youtube", tags=["youtube"])

@router.get("/status")
def status(user: User = Depends(get_current_user)):
    return get_youtube_status(user)

@router.post("/retry")
def retry(user: User = Depends(get_current_user)):
    return retry_playlist_removals(user)

@router.post("/disconnect")
def disconnect(user: User = Depends(get_current_user)):
    return disconnect_youtube(user)
