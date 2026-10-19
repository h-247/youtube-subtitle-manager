import base64
import hashlib
import logging
from datetime import datetime, timezone

import httpx
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models.user import User
from app.models.video import Video

logger = logging.getLogger(__name__)


def _site_headers(token: str | None = None) -> dict[str, str]:
    headers = {}
    if settings.SITES_SERVICE_TOKEN:
        headers["OAI-Sites-Authorization"] = f"Bearer {settings.SITES_SERVICE_TOKEN}"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _cipher() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest())
    return Fernet(key)


def encrypt_token(token: str) -> str:
    return _cipher().encrypt(token.encode("utf-8")).decode("ascii")


def decrypt_token(encrypted: str) -> str:
    return _cipher().decrypt(encrypted.encode("ascii")).decode("utf-8")


def verify_pairing_token(token: str) -> bool:
    return get_pairing_status(token).get("is_connected") is True


def get_pairing_status(token: str) -> dict[str, bool]:
    """Read the paired Site and its Drive connection without exposing credentials."""
    try:
        response = httpx.get(
            f"{settings.SITES_SYNC_URL.rstrip('/')}/api/sync/status",
            headers=_site_headers(token), timeout=10,
        )
        if response.status_code != 200:
            return {"is_connected": False, "drive_is_configured": False, "drive_is_connected": False}
        payload = response.json()
        return {
            "is_connected": payload.get("is_connected") is True,
            "drive_is_configured": payload.get("drive_is_configured") is True,
            "drive_is_connected": payload.get("drive_is_connected") is True,
        }
    except (httpx.HTTPError, ValueError, InvalidToken):
        return {"is_connected": False, "drive_is_configured": False, "drive_is_connected": False}


def get_pairing_identity(token: str) -> dict[str, str] | None:
    """Resolve the ChatGPT Site identity bound to a valid local pairing token."""
    try:
        response = httpx.get(
            f"{settings.SITES_SYNC_URL.rstrip('/')}/api/sync/identity",
            headers=_site_headers(token), timeout=10,
        )
        if response.status_code != 200:
            return None
        identity = response.json()
        user_id = identity.get("user_id")
        email = identity.get("email")
        if not isinstance(user_id, str) or not user_id or not isinstance(email, str) or not email:
            return None
        return {"user_id": user_id, "email": email}
    except (httpx.HTTPError, ValueError):
        return None


def _payload(video: Video) -> dict:
    return {
        "video_id": video.video_id, "youtube_url": video.youtube_url, "title": video.title,
        "channel_title": video.channel_title, "channel_url": video.channel_url,
        "duration": video.duration, "thumbnail_url": video.thumbnail_url,
        "status": video.status, "watch_status": video.watch_status,
        "channel_tags": video.channel_tags, "subtitle_type": video.subtitle_type,
        "subtitle_language": video.subtitle_language, "subtitle_text": video.subtitle_text,
        "drive_file_id": video.drive_file_id, "drive_file_url": video.drive_file_url,
        "chatgpt_link": video.chatgpt_link, "retry_count": video.retry_count or 0,
        "progress_message": video.progress_message, "error_message": video.error_message,
        "created_at": video.created_at.isoformat() if video.created_at else None,
        "updated_at": video.updated_at.isoformat() if video.updated_at else None,
        "last_attempt_at": None,
    }


def sync_video(db: Session, video: Video) -> None:
    from app.services.durable_jobs import enqueue_sync
    enqueue_sync(db, video)
    db.commit()


def refresh_drive_links(db: Session, user: User) -> int:
    """Copy file links owned by the paired Site user into matching local records."""
    if not user.sites_sync_token:
        return 0
    token = decrypt_token(user.sites_sync_token)
    offset = 0
    updated = 0
    while True:
        response = httpx.get(
            f"{settings.SITES_SYNC_URL.rstrip('/')}/api/sync/drive-links",
            headers=_site_headers(token), params={"offset": offset}, timeout=15,
        )
        response.raise_for_status()
        payload = response.json()
        items = payload.get("items")
        if not isinstance(items, list):
            raise ValueError("Sites Drive links response is invalid.")
        video_ids = [item.get("video_id") for item in items if isinstance(item, dict) and isinstance(item.get("video_id"), str)]
        videos = {
            item.video_id: item for item in db.query(Video).filter(
                Video.user_id == user.id, Video.video_id.in_(video_ids),
            ).all()
        } if video_ids else {}
        for item in items:
            if not isinstance(item, dict):
                continue
            video = videos.get(item.get("video_id"))
            file_id = item.get("drive_file_id")
            file_url = item.get("drive_file_url")
            if video and isinstance(file_id, str) and file_id and isinstance(file_url, str) and file_url:
                if video.drive_file_id != file_id or video.drive_file_url != file_url:
                    video.drive_file_id = file_id
                    video.drive_file_url = file_url
                    video.progress_message = "Subtitles ready and synced to Google Drive via Sites"
                    updated += 1
        next_offset = payload.get("next_offset")
        if next_offset is None:
            break
        if not isinstance(next_offset, int) or next_offset <= offset:
            raise ValueError("Sites Drive links pagination is invalid.")
        offset = next_offset
    db.commit()
    return updated


def sync_video_async(video_db_id: int) -> None:
    # Persist before returning; no network or transient thread here.
    with SessionLocal() as db:
        video = db.get(Video, video_db_id)
        if video:
            sync_video(db, video)


def sync_user_async(user_id: int) -> None:
    with SessionLocal() as db:
        for video in db.query(Video).filter(Video.user_id == user_id).all():
            from app.services.durable_jobs import enqueue_sync
            enqueue_sync(db, video)
        db.commit()


def _timestamp(value):
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if not isinstance(value, datetime):
        raise ValueError("Invalid library timestamp")
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def reconcile_library(db: Session, user: User) -> dict:
    """Pull newer Site edits and repair missing outbound records without echoing pulls."""
    from app.models.sync_operation import SyncOperation
    from app.models.channel_tag import ChannelTag
    from app.services.durable_jobs import enqueue_sync
    if not user.sites_sync_token:
        return {"pulled": 0, "queued": 0}
    headers = _site_headers(decrypt_token(user.sites_sync_token))
    remote = {}
    channel_tags = {}
    offset = 0
    # Complete and validate the snapshot before making any local mutations.
    while True:
        response = httpx.get(settings.SITES_SYNC_URL.rstrip('/') + '/api/sync/library',
                             headers=headers, params={"offset": offset}, timeout=15)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload.get("items"), list) or not isinstance(payload.get("channel_tags"), list):
            raise ValueError("Invalid Sites library snapshot")
        for item in payload["items"]:
            if not isinstance(item, dict) or not isinstance(item.get("video_id"), str):
                raise ValueError("Invalid Sites library item")
            _timestamp(item.get("updated_at"))
            remote[item["video_id"]] = item
        for item in payload["channel_tags"]:
            if not isinstance(item, dict) or not isinstance(item.get("channel_title"), str) or not isinstance(item.get("tag"), str):
                raise ValueError("Invalid Sites channel tag")
            channel_tags.setdefault(item["channel_title"], set()).add(item["tag"])
        next_offset = payload.get("next_offset")
        if next_offset is None:
            break
        if not isinstance(next_offset, int) or next_offset <= offset:
            raise ValueError("Invalid Sites library pagination")
        offset = next_offset
    pending = {item.video_id for item in db.query(SyncOperation).filter(SyncOperation.user_id == user.id).all()}
    videos = db.query(Video).filter(Video.user_id == user.id).all()
    pending_channels = {v.channel_title for v in videos if v.video_id in pending}
    pulled = queued = 0
    db.info["sites_pull"] = True
    try:
        for video in videos:
            if video.video_id in pending:
                continue
            item = remote.get(video.video_id)
            if item is None:
                enqueue_sync(db, video)
                queued += 1
                continue
            if _timestamp(item["updated_at"]) <= _timestamp(video.updated_at):
                continue
            if item.get("watch_status") in {"TO_DO", "DOING", "DONE"}:
                video.watch_status = item["watch_status"]
            video.chatgpt_link = item.get("chatgpt_link")
            if video.channel_title not in pending_channels:
                tags = channel_tags.get(video.channel_title, set()) | {
                    tag.strip().lstrip("#").lower() for tag in (item.get("channel_tags") or "").split(",") if tag.strip()
                }
                video.channel_tags = ", ".join(sorted(tags)) or None
                db.query(ChannelTag).filter(ChannelTag.user_id == user.id, ChannelTag.channel_title == video.channel_title).delete()
                for tag in sorted(tags):
                    db.add(ChannelTag(user_id=user.id, channel_title=video.channel_title, tag=tag))
            if item.get("drive_file_id") and item.get("drive_file_url"):
                video.drive_file_id = item["drive_file_id"]
                video.drive_file_url = item["drive_file_url"]
            video.updated_at = _timestamp(item["updated_at"])
            pulled += 1
        db.commit()
    finally:
        db.info.pop("sites_pull", None)
    return {"pulled": pulled, "queued": queued}


def reconcile_libraries() -> None:
    with SessionLocal() as db:
        user_ids = [item.id for item in db.query(User).filter(User.sites_sync_token.isnot(None)).all()]
    for user_id in user_ids:
        with SessionLocal() as db:
            try:
                reconcile_library(db, db.get(User, user_id))
            except Exception:
                db.rollback()
                logger.warning("Could not reconcile Sites library for local user %s; retrying", user_id)
