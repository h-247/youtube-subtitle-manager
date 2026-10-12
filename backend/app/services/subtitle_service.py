import os
import glob
import time
import logging
from typing import Tuple, Optional, Dict, Any
import yt_dlp

from app.config import settings
from app.services.youtube_service import get_ydl_cookie_opts

logger = logging.getLogger(__name__)

RATE_LIMIT_ERROR_MESSAGE = (
    "YouTube is temporarily rate limiting subtitle requests (HTTP 429: Too Many Requests). "
    "Please wait a few minutes before retrying."
)


def is_http_429_error(exc: Exception) -> bool:
    """
    Checks if an exception represents an HTTP 429 (Too Many Requests / rate limit) error.
    """
    code = getattr(exc, "code", None) or getattr(exc, "status", None) or getattr(exc, "status_code", None)
    if code == 429:
        return True

    if getattr(exc, "__cause__", None) and is_http_429_error(exc.__cause__):
        return True
    if getattr(exc, "__context__", None) and is_http_429_error(exc.__context__):
        return True

    msg = str(exc).lower()
    return "429" in msg or "too many requests" in msg


def select_english_subtitle(subtitles: Optional[Dict[str, Any]], auto_subtitles: Optional[Dict[str, Any]]) -> Tuple[Optional[str], str]:
    """
    Prefers manual English captions over automatic English captions.
    Returns (lang_code, subtitle_type) where subtitle_type is 'MANUAL', 'AUTO', or 'NONE'.
    """
    subtitles = subtitles or {}
    auto_subtitles = auto_subtitles or {}

    # 1. Check manual English captions
    # Exact matches first
    for preferred in ["en", "en-US", "en-GB", "en-CA", "en-AU"]:
        if preferred in subtitles:
            return preferred, "MANUAL"
    # Prefix matches
    for lang in subtitles.keys():
        if lang.lower().startswith("en"):
            return lang, "MANUAL"

    # 2. Check automatic English captions
    for preferred in ["en", "en-US", "en-GB", "en-CA", "en-AU"]:
        if preferred in auto_subtitles:
            return preferred, "AUTO"
    for lang in auto_subtitles.keys():
        if lang.lower().startswith("en"):
            return lang, "AUTO"

    return None, "NONE"


def download_subtitles(
    video_id: str,
    youtube_url: str,
    max_retries: Optional[int] = None,
    retry_delay: Optional[float] = None,
    backoff_factor: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Attempts to download English subtitles for a YouTube video using yt-dlp.
    Handles no-subtitle and failed cases gracefully without raising unhandled exceptions.
    Retries bounded number of times with exponential backoff on HTTP 429 rate limiting.

    Returns dict:
        {
            "status": "COMPLETED" | "NO_SUBTITLES" | "FAILED",
            "subtitle_type": "MANUAL" | "AUTO" | "NONE",
            "subtitle_language": str | None,
            "file_path": str | None,
            "error_message": str | None
        }
    """
    os.makedirs(settings.SUBTITLE_STORAGE_DIR, exist_ok=True)
    temp_dir = settings.SUBTITLE_STORAGE_DIR

    if max_retries is None:
        max_retries = (
            settings.SUBTITLE_RETRY_ATTEMPTS
            if getattr(settings, "SUBTITLE_RETRY_ATTEMPTS", None) is not None
            else getattr(settings, "SUBTITLE_MAX_RETRIES", 3)
        )
    if retry_delay is None:
        retry_delay = (
            settings.SUBTITLE_RETRY_BACKOFF_DELAY
            if getattr(settings, "SUBTITLE_RETRY_BACKOFF_DELAY", None) is not None
            else getattr(settings, "SUBTITLE_RETRY_DELAY", 1.0)
        )
    if backoff_factor is None:
        backoff_factor = getattr(settings, "SUBTITLE_RETRY_BACKOFF_FACTOR", 2.0)

    subtitle_type = "NONE"
    lang_code = None

    try:
        # Step 1: Extract subtitle metadata
        cookie_opts = get_ydl_cookie_opts()
        ydl_opts_meta = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "no_color": True,
        }
        ydl_opts_meta.update(cookie_opts)

        info = None
        for attempt in range(max_retries + 1):
            try:
                with yt_dlp.YoutubeDL(ydl_opts_meta) as ydl:
                    info = ydl.extract_info(youtube_url, download=False)
                break
            except Exception as exc:
                if is_http_429_error(exc) and attempt < max_retries:
                    delay = retry_delay * (backoff_factor ** attempt)
                    time.sleep(delay)
                    continue
                if "cookiesfrombrowser" in ydl_opts_meta and ("cookie" in str(exc).lower() or "permission denied" in str(exc).lower()):
                    logger.warning("yt-dlp failed reading browser cookies (%s), falling back to no cookies", exc)
                    ydl_opts_meta.pop("cookiesfrombrowser", None)
                    continue
                raise

        if not info:
            return {
                "status": "FAILED",
                "subtitle_type": "NONE",
                "subtitle_language": None,
                "file_path": None,
                "error_message": "Could not extract video metadata",
            }

        subtitles = info.get("subtitles") or {}
        auto_subtitles = info.get("automatic_captions") or {}

        lang_code, subtitle_type = select_english_subtitle(subtitles, auto_subtitles)

        if subtitle_type == "NONE" or not lang_code:
            return {
                "status": "NO_SUBTITLES",
                "subtitle_type": "NONE",
                "subtitle_language": None,
                "file_path": None,
                "error_message": None,
            }

        # Step 2: Download the chosen subtitle
        out_template = os.path.join(temp_dir, f"{video_id}.%(ext)s")
        ydl_opts_down = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "writesubtitles": (subtitle_type == "MANUAL"),
            "writeautomaticsub": (subtitle_type == "AUTO"),
            "subtitleslangs": [lang_code],
            "subtitlesformat": "vtt/srt/best",
            "outtmpl": out_template,
            "no_color": True,
        }
        ydl_opts_down.update(cookie_opts)

        for attempt in range(max_retries + 1):
            try:
                with yt_dlp.YoutubeDL(ydl_opts_down) as ydl:
                    ydl.download([youtube_url])
                break
            except Exception as exc:
                if is_http_429_error(exc) and attempt < max_retries:
                    delay = retry_delay * (backoff_factor ** attempt)
                    time.sleep(delay)
                    continue
                if "cookiesfrombrowser" in ydl_opts_down and ("cookie" in str(exc).lower() or "permission denied" in str(exc).lower()):
                    logger.warning("yt-dlp failed reading browser cookies (%s), falling back to no cookies", exc)
                    ydl_opts_down.pop("cookiesfrombrowser", None)
                    continue
                raise

        # Step 3: Find generated subtitle file
        matching_files = (
            glob.glob(os.path.join(temp_dir, f"{video_id}*.vtt"))
            + glob.glob(os.path.join(temp_dir, f"{video_id}*.srt"))
            + glob.glob(os.path.join(temp_dir, f"{video_id}*.ttml"))
        )

        if matching_files:
            file_path = matching_files[0]
            return {
                "status": "COMPLETED",
                "subtitle_type": subtitle_type,
                "subtitle_language": lang_code,
                "file_path": file_path,
                "error_message": None,
            }
        else:
            return {
                "status": "FAILED",
                "subtitle_type": subtitle_type,
                "subtitle_language": lang_code,
                "file_path": None,
                "error_message": "Subtitle file was not written to disk",
            }

    except Exception as exc:
        if is_http_429_error(exc):
            error_message = RATE_LIMIT_ERROR_MESSAGE
        else:
            error_message = str(exc)

        return {
            "status": "FAILED",
            "subtitle_type": subtitle_type,
            "subtitle_language": lang_code,
            "file_path": None,
            "error_message": error_message,
        }

