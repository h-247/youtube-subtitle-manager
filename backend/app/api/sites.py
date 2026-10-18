import hmac
import os
import re
from urllib.parse import urlparse

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, field_validator

from app.config import settings
from app.services.subtitle_service import download_subtitles

router = APIRouter(prefix="/sites", tags=["sites"])


class SubtitleRequest(BaseModel):
    video_id: str
    youtube_url: str

    @field_validator("video_id")
    @classmethod
    def validate_video_id(cls, value: str) -> str:
        value = value.strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{11}", value):
            raise ValueError("A valid 11-character YouTube video ID is required.")
        return value

    @field_validator("youtube_url")
    @classmethod
    def validate_youtube_url(cls, value: str, info) -> str:
        parsed = urlparse(value)
        host = (parsed.hostname or "").lower().removeprefix("www.")
        if parsed.scheme != "https" or host not in {"youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"}:
            raise ValueError("Only HTTPS YouTube video URLs are supported.")
        match = re.search(r"(?:v=|youtu\.be/|/(?:shorts|embed|live)/)([A-Za-z0-9_-]{11})", value)
        expected_id = info.data.get("video_id")
        if not match or match.group(1) != expected_id:
            raise ValueError("The URL must identify the requested YouTube video.")
        return value


@router.post("/subtitle")
def download_site_subtitle(
    payload: SubtitleRequest,
    authorization: str | None = Header(default=None),
):
    configured_token = settings.SUBTITLE_BACKEND_TOKEN
    if not configured_token:
        raise HTTPException(status_code=503, detail="Subtitle service authentication is not configured.")
    expected = f"Bearer {configured_token}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Invalid subtitle service credentials.")

    result = download_subtitles(payload.video_id, payload.youtube_url)
    status = result.get("status")
    if status == "NO_SUBTITLES":
        raise HTTPException(status_code=422, detail="No English subtitle track is available for this video.")
    if status != "COMPLETED" or not result.get("file_path"):
        raise HTTPException(status_code=502, detail=result.get("error_message") or "yt-dlp could not download subtitles.")

    file_path = result["file_path"]
    try:
        with open(file_path, "r", encoding="utf-8-sig") as subtitle_file:
            subtitle_text = subtitle_file.read()
    except OSError:
        raise HTTPException(status_code=502, detail="yt-dlp created a subtitle file that could not be read.") from None
    finally:
        try:
            os.remove(file_path)
        except OSError:
            pass

    return {
        "subtitle_text": subtitle_text,
        "subtitle_type": result.get("subtitle_type", "AUTO"),
        "subtitle_language": result.get("subtitle_language") or "en",
    }
