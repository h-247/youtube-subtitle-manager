import threading
import time
import json
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any, Set
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.video import Video
from app.models.user import User
from app.services.subtitle_service import download_subtitles
from app.services.drive_service import drive_service
from app.services.sites_sync_service import sync_video

logger = logging.getLogger(__name__)

# Track video DB IDs currently being processed to prevent duplicate concurrent worker threads
_active_video_ids: Set[int] = set()
_lock = threading.Lock()

# Worker configuration (can be adjusted or patched during tests)
INITIAL_RETRY_DELAY_SECONDS = 3.0
MAX_RETRY_DELAY_SECONDS = 30.0


def get_db_session():
    return SessionLocal()


def is_job_active(video_db_id: int) -> bool:
    with _lock:
        return video_db_id in _active_video_ids


def queue_video_processing(video_db_id: int, user_id: int, initial_delay: float = 0.0) -> None:
    """
    Enqueues background processing for a video.
    Ensures that an already PROCESSING video does not receive a second concurrent job.
    """
    # PROCESSING rows are the durable queue; the dispatcher owns worker creation.
    with get_db_session() as db:
        video = db.query(Video).filter(Video.id == video_db_id, Video.user_id == user_id).first()
        if video and video.status not in ("PROCESSING", "COMPLETED"):
            video.status = "PROCESSING"
            db.commit()


def dispatch_pending() -> None:
    from app.config import settings
    with _lock:
        capacity = max(1, settings.DOWNLOAD_CONCURRENCY) - len(_active_video_ids)
        if capacity <= 0:
            return
        with get_db_session() as db:
            pending = db.query(Video).filter(Video.status == "PROCESSING", Video.processing_paused == 0).order_by(Video.updated_at, Video.id).all()
            for video in pending:
                if video.id in _active_video_ids:
                    continue
                if video.error_message and video.retry_count:
                    updated = video.updated_at
                    if updated and updated.tzinfo is None:
                        updated = updated.replace(tzinfo=timezone.utc)
                    delay = min(INITIAL_RETRY_DELAY_SECONDS * (1.5 ** min(video.retry_count - 1, 20)), MAX_RETRY_DELAY_SECONDS)
                    if updated and (datetime.now(timezone.utc) - updated).total_seconds() < delay:
                        continue
                _active_video_ids.add(video.id)
                threading.Thread(target=_process_video_worker, args=(video.id, video.user_id, 0), daemon=True).start()
                capacity -= 1
                if capacity == 0:
                    break


def _process_video_worker(video_db_id: int, user_id: int, initial_delay: float) -> None:
    import os
    import tempfile
    stage = "DOWNLOAD"
    try:
        with get_db_session() as db:
            video = db.query(Video).filter_by(id=video_db_id, user_id=user_id).first()
            if not video or video.status != "PROCESSING" or video.processing_paused:
                return
            # Persisted subtitle text is the upload source, including after restart.
            if not video.download_complete:
                video.progress_message = "Downloading subtitles..."
                db.commit()
                result = download_subtitles(video.video_id, video.youtube_url)
                if result.get("status") != "COMPLETED":
                    stage = "NO_SUBTITLES" if result.get("status") == "NO_SUBTITLES" else "DOWNLOAD"
                    raise RuntimeError(result.get("error_message") or "No English subtitles found yet")
                path = result.get("file_path")
                text = None
                if path:
                    with open(path, encoding="utf-8-sig") as source:
                        text = source.read()
                db.refresh(video)
                video.subtitle_text = text
                video.subtitle_type = result.get("subtitle_type", "NONE")
                video.subtitle_language = result.get("subtitle_language")
                video.download_complete = 1
                video.error_message = None
                video.error_category = None
                db.commit()  # Durable boundary BEFORE attempting Drive.
                if path:
                    try:
                        os.remove(path)
                    except OSError:
                        pass
            db.refresh(video)
            if video.processing_paused or video.status != "PROCESSING":
                return
            user = db.get(User, user_id)
            stage = "DRIVE_UPLOAD"
            if user.drive_credentials and video.subtitle_text is not None and not video.drive_file_id:
                video.progress_message = "Uploading saved subtitles to Google Drive..."
                db.commit()
                temp_path = None
                try:
                    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", encoding="utf-8", delete=False) as saved:
                        saved.write(video.subtitle_text)
                        temp_path = saved.name
                    upload = drive_service.upload_subtitle(file_path=temp_path, title=video.title,
                        credentials_data=json.loads(user.drive_credentials), delete_on_success=False)
                    if not upload.get("drive_file_id"):
                        raise RuntimeError("Drive did not acknowledge upload")
                    db.refresh(video)
                    video.drive_file_id = upload["drive_file_id"]
                    video.drive_file_url = upload.get("drive_file_url")
                finally:
                    if temp_path and os.path.exists(temp_path):
                        os.remove(temp_path)
            video.status = "COMPLETED"
            video.error_message = None
            video.error_category = None
            video.progress_message = "Subtitles downloaded and archived successfully."
            db.commit()
    except Exception:
        logger.warning("Processing attempt failed for video %s at %s", video_db_id, stage)
        with get_db_session() as db:
            video = db.query(Video).filter_by(id=video_db_id, user_id=user_id).first()
            if video and video.status == "PROCESSING":
                video.retry_count += 1
                video.error_category = stage
                video.error_message = {"DOWNLOAD": "Subtitle download failed", "NO_SUBTITLES": "No English subtitles found yet", "DRIVE_UPLOAD": "Drive upload failed; downloaded subtitles are saved"}[stage]
                video.progress_message = f"{video.error_message}. Automatic retry pending (attempt {video.retry_count})."
                db.commit()
    finally:
        with _lock:
            _active_video_ids.discard(video_db_id)
