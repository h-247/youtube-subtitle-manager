import threading
import time
import json
import logging
from typing import Optional, Dict, Any, Set
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.video import Video
from app.models.user import User
from app.services.subtitle_service import download_subtitles
from app.services.drive_service import drive_service

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
    with _lock:
        if video_db_id in _active_video_ids:
            return
        _active_video_ids.add(video_db_id)

    thread = threading.Thread(
        target=_process_video_worker,
        args=(video_db_id, user_id, initial_delay),
        daemon=True,
    )
    thread.start()


def _process_video_worker(video_db_id: int, user_id: int, initial_delay: float) -> None:
    try:
        if initial_delay > 0:
            time.sleep(initial_delay)

        retry_count = 0

        while True:
            # Check if video still exists and is in PROCESSING state
            with get_db_session() as db:
                video = (
                    db.query(Video)
                    .filter(Video.id == video_db_id, Video.user_id == user_id)
                    .first()
                )
                if not video:
                    # Video deleted from library
                    break
                if video.status != "PROCESSING":
                    # Status manually changed or cancelled
                    break

                video_id = video.video_id
                youtube_url = video.youtube_url
                video_title = video.title

                # Read user drive credentials if available
                user = db.query(User).filter(User.id == user_id).first()
                user_credentials = None
                if user and user.drive_credentials:
                    try:
                        user_credentials = json.loads(user.drive_credentials)
                    except Exception:
                        user_credentials = None

                # Update progress message
                if retry_count == 0:
                    video.progress_message = "Downloading subtitles..."
                else:
                    video.progress_message = f"Retrying subtitle download (attempt {retry_count + 1})..."
                db.commit()

            # Execute subtitle download
            try:
                sub_result = download_subtitles(video_id, youtube_url)
            except Exception as exc:
                sub_result = {
                    "status": "FAILED",
                    "subtitle_type": "NONE",
                    "subtitle_language": None,
                    "file_path": None,
                    "error_message": str(exc),
                }

            status_result = sub_result.get("status")

            if status_result == "COMPLETED":
                file_path = sub_result.get("file_path")
                drive_id = None
                drive_url = None
                drive_error = None

                if file_path and user_credentials:
                    try:
                        with get_db_session() as db:
                            v_curr = db.query(Video).filter(Video.id == video_db_id).first()
                            if v_curr:
                                v_curr.progress_message = "Uploading subtitles to Google Drive..."
                                db.commit()

                        drive_upload = drive_service.upload_subtitle(
                            file_path=file_path,
                            title=video_title,
                            credentials_data=user_credentials,
                            delete_on_success=True,
                        )
                        drive_id = drive_upload.get("drive_file_id")
                        drive_url = drive_upload.get("drive_file_url")
                    except Exception as drive_err:
                        drive_error = f"Drive upload failed: {str(drive_err)}"

                if file_path and not user_credentials:
                    import os
                    if os.path.exists(file_path):
                        try:
                            os.remove(file_path)
                        except OSError:
                            pass

                # If drive upload failed, retry the whole process indefinitely as required by AC3
                if drive_error:
                    retry_count += 1
                    with get_db_session() as db:
                        video = db.query(Video).filter(Video.id == video_db_id).first()
                        if not video or video.status != "PROCESSING":
                            break
                        video.retry_count = retry_count
                        video.error_message = drive_error
                        video.progress_message = f"{drive_error}. Retrying indefinitely (attempt {retry_count})..."
                        db.commit()

                    delay = min(INITIAL_RETRY_DELAY_SECONDS * (1.5 ** (retry_count - 1)), MAX_RETRY_DELAY_SECONDS)
                    time.sleep(delay)
                    continue

                # Everything succeeded!
                with get_db_session() as db:
                    video = db.query(Video).filter(Video.id == video_db_id).first()
                    if video and video.status == "PROCESSING":
                        video.status = "COMPLETED"
                        video.subtitle_type = sub_result.get("subtitle_type", "NONE")
                        video.subtitle_language = sub_result.get("subtitle_language")
                        video.drive_file_id = drive_id
                        video.drive_file_url = drive_url
                        video.error_message = None
                        video.progress_message = "Subtitles downloaded and archived successfully."
                        db.commit()
                break

            # Handle retryable conditions: NO_SUBTITLES or FAILED
            # As per requirements: "A lack of English subtitles is also a retryable processing result and must stay in the retry loop"
            # "Retry every subtitle/Drive processing failure indefinitely; do not mark the job as final FAILED or NO_SUBTITLES while automatic retries continue."
            retry_count += 1
            err_msg = sub_result.get("error_message") or (
                "No English subtitles found yet" if status_result == "NO_SUBTITLES" else "Subtitle download failed"
            )

            with get_db_session() as db:
                video = db.query(Video).filter(Video.id == video_db_id).first()
                if not video or video.status != "PROCESSING":
                    break
                video.retry_count = retry_count
                video.error_message = err_msg
                video.progress_message = f"{err_msg}. Retrying (attempt {retry_count})..."
                db.commit()

            delay = min(INITIAL_RETRY_DELAY_SECONDS * (1.5 ** (retry_count - 1)), MAX_RETRY_DELAY_SECONDS)
            time.sleep(delay)

    except Exception as exc:
        logger.exception("Unexpected error in video processing worker for video_id %s: %s", video_db_id, exc)
    finally:
        with _lock:
            _active_video_ids.discard(video_db_id)
