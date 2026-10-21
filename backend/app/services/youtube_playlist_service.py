"""The paired Site owns YouTube OAuth and durable, exact-membership removals."""
import httpx
from fastapi import HTTPException
from app.config import settings
from app.database import SessionLocal
from app.models.user import User
from app.services.sites_sync_service import decrypt_token, _site_headers

def _request(user, path, method="GET", params=None):
    if not user.sites_sync_token:
        raise HTTPException(409, "Connect Sites first, then connect YouTube from the playlist import form.")
    try:
        response = httpx.request(method, settings.SITES_SYNC_URL.rstrip("/") + "/api/sync/youtube/" + path,
                                 headers=_site_headers(decrypt_token(user.sites_sync_token)), params=params, timeout=60)
    except httpx.HTTPError:
        raise HTTPException(502, "Sites is unreachable. No source playlist items were removed.")
    if not response.is_success:
        try:
            detail = response.json().get("detail", "Could not access your YouTube playlist.")
        except (ValueError, AttributeError):
            detail = "Could not access your YouTube playlist. Sites returned an invalid response."
        raise HTTPException(response.status_code if response.status_code in (409, 422) else 502, detail)
    return response.json()

def fetch_managed_playlist(user, playlist_id):
    payload = _request(user, "playlist", params={"playlist_id": playlist_id})
    if not isinstance(payload.get("title"), str) or not isinstance(payload.get("videos"), list):
        raise HTTPException(502, "Sites returned an incomplete playlist snapshot. Nothing was imported.")
    result = []
    for item in payload["videos"]:
        if not isinstance(item, dict) or not item.get("video_id") or not item.get("playlist_item_id"):
            raise HTTPException(502, "Sites returned an incomplete playlist membership. Nothing was imported.")
        result.append({**item, "playlist_title": payload["title"], "youtube_url": "https://www.youtube.com/watch?v=" + item["video_id"]})
    return result

def get_youtube_status(user):
    if not user.sites_sync_token:
        return {"is_connected": False, "is_configured": False, "jobs": [], "pending_count": 0, "removed_count": 0, "failed_count": 0, "connect_url": settings.SITES_SYNC_URL.rstrip("/") + "/api/youtube/connect"}
    return _request(user, "status")

def disconnect_youtube(user):
    return _request(user, "disconnect", method="POST")

def retry_playlist_removals(user):
    return _request(user, "retry", method="POST")

def process_playlist_removals():
    with SessionLocal() as db:
        users = db.query(User).filter(User.sites_sync_token.isnot(None)).all()
        for user in users:
            try:
                get_youtube_status(user)
            except (HTTPException, ValueError):
                # Server retains the queue; retry the next dispatcher tick.
                pass
