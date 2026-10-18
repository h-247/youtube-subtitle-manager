import re
from typing import List, Dict, Any, Optional
import yt_dlp


YOUTUBE_VIDEO_ID_REGEX = re.compile(
    r"(?:v=|\/|youtu\.be\/|embed\/|shorts\/)([0-9A-Za-z_-]{11})"
)
YOUTUBE_PLAYLIST_ID_REGEX = re.compile(r"[?&]list=([0-9A-Za-z_-]+)")


def is_playlist_url(url: str) -> bool:
    """Return True if the URL points to a YouTube playlist."""
    if "list=" in url:
        return True
    return "/playlist" in url


def extract_video_id(url: str) -> Optional[str]:
    """Extract YouTube 11-char video ID from various URL formats."""
    match = YOUTUBE_VIDEO_ID_REGEX.search(url)
    if match:
        return match.group(1)
    return None


import os
import logging
import json
import re
import tempfile
import time
from app.config import settings

logger = logging.getLogger(__name__)


def get_ydl_cookie_opts() -> dict:
    """
    Returns cookie options for yt-dlp.
    1. Checks if a cookies file exists (configured path, backend/cookies.txt, or root cookies.txt).
    2. Otherwise checks if YTDLP_COOKIES_FROM_BROWSER is configured (e.g. 'brave', 'chrome', 'firefox').
    """
    opts = {}
    cookie_json = getattr(settings, "YTDLP_COOKIES_JSON", None)
    if cookie_json:
        try:
            entries = json.loads(cookie_json)
        except (TypeError, json.JSONDecodeError) as exc:
            raise ValueError("YTDLP_COOKIES_JSON must contain a JSON array of YouTube cookies.") from exc
        if not isinstance(entries, list):
            raise ValueError("YTDLP_COOKIES_JSON must contain a JSON array of YouTube cookies.")
        lines = ["# Netscape HTTP Cookie File"]
        for cookie in entries:
            if not isinstance(cookie, dict):
                continue
            name, value, domain = cookie.get("name"), cookie.get("value"), cookie.get("domain")
            if not all(isinstance(part, str) for part in (name, value, domain)):
                continue
            normalized_domain = domain.lstrip(".").lower()
            if normalized_domain != "youtube.com" or not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z_-]+", name):
                continue
            if any(character in value for character in "\r\n\t"):
                continue
            expires = cookie.get("expirationDate")
            try:
                expires = int(expires or 0)
            except (TypeError, ValueError, OverflowError):
                expires = 0
            if expires and expires < int(time.time()):
                continue
            include_subdomains = not bool(cookie.get("hostOnly")) or domain.startswith(".")
            cookie_domain = f"#HttpOnly_{domain}" if cookie.get("httpOnly") else domain
            lines.append("\t".join((
                cookie_domain,
                "TRUE" if include_subdomains else "FALSE",
                "/",  # Cookie export paths are unnecessary for yt-dlp and cannot inject fields.
                "TRUE" if cookie.get("secure") else "FALSE",
                str(expires),
                name,
                value,
            )))
        if len(lines) == 1:
            raise ValueError("YTDLP_COOKIES_JSON contains no usable, unexpired YouTube cookies.")
        cookie_dir = os.path.join(tempfile.gettempdir(), "youtube-subtitle-manager")
        os.makedirs(cookie_dir, mode=0o700, exist_ok=True)
        cookie_path = os.path.join(cookie_dir, "youtube-cookies.txt")
        temporary_path = f"{cookie_path}.tmp"
        with open(temporary_path, "w", encoding="utf-8", newline="\n") as cookie_file:
            cookie_file.write("\n".join(lines) + "\n")
        try:
            os.chmod(temporary_path, 0o600)
        except OSError:
            pass
        os.replace(temporary_path, cookie_path)
        opts["cookiefile"] = cookie_path
        return opts

    cookie_path = getattr(settings, "YTDLP_COOKIES_FILE", "cookies.txt")
    if cookie_path:
        candidates = []
        if os.path.isabs(cookie_path):
            candidates.append(cookie_path)
        else:
            base_backend = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
            base_root = os.path.dirname(base_backend)
            candidates.extend([
                os.path.join(base_backend, cookie_path),
                os.path.join(base_root, cookie_path),
                os.path.abspath(cookie_path),
            ])
        for c in candidates:
            if os.path.isfile(c) and os.path.getsize(c) > 0:
                logger.info("Using yt-dlp cookiefile: %s", c)
                opts["cookiefile"] = c
                return opts

    browser = getattr(settings, "YTDLP_COOKIES_FROM_BROWSER", None)
    if browser:
        logger.info("Using yt-dlp cookies from browser: %s", browser)
        opts["cookiesfrombrowser"] = (browser, None, None, None)

    return opts


def get_ydl_opts(extract_flat: bool = False) -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "extract_flat": extract_flat,
        "no_color": True,
        "ignoreerrors": True,
    }
    opts.update(get_ydl_cookie_opts())
    return opts


def extract_metadata(url: str) -> Dict[str, Any]:
    """
    Extract video or playlist metadata using yt-dlp.
    Returns the yt-dlp info dictionary.
    """
    ydl_opts = get_ydl_opts(extract_flat=is_playlist_url(url))
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
        return info or {}


def parse_video_item(entry: Dict[str, Any]) -> Dict[str, Any]:
    """Extract standardized metadata fields from a yt-dlp info entry."""
    video_id = entry.get("id") or extract_video_id(entry.get("url", "")) or entry.get("webpage_url_basename")
    title = entry.get("title") or "Untitled Video"
    channel = entry.get("uploader") or entry.get("channel") or ""
    channel_url = entry.get("uploader_url") or entry.get("channel_url")
    duration = entry.get("duration")
    thumbnail = entry.get("thumbnail")

    # If thumbnail is in thumbnails list, pick best
    if not thumbnail and entry.get("thumbnails"):
        thumbnail = entry["thumbnails"][-1].get("url")

    # Standardize YouTube URL
    youtube_url = entry.get("webpage_url")
    if not youtube_url and video_id:
        youtube_url = f"https://www.youtube.com/watch?v={video_id}"

    return {
        "video_id": video_id,
        "title": title,
        "channel_title": channel,
        "channel_url": channel_url,
        "duration": duration,
        "thumbnail_url": thumbnail,
        "youtube_url": youtube_url,
    }


def extract_items_from_url(url: str) -> List[Dict[str, Any]]:
    """
    Extracts one or more video metadata records from a single video, Shorts, or playlist URL.
    """
    info = extract_metadata(url)
    if not info:
        # Fallback if yt-dlp returned nothing, try video id regex
        vid = extract_video_id(url)
        if vid:
            return [{
                "video_id": vid,
                "title": f"YouTube Video {vid}",
                "channel_title": "",
                "channel_url": None,
                "duration": None,
                "thumbnail_url": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
                "youtube_url": f"https://www.youtube.com/watch?v={vid}",
            }]
        return []

    if "entries" in info and info["entries"]:
        items = []
        for entry in info["entries"]:
            if not entry:
                continue
            parsed = parse_video_item(entry)
            if parsed.get("video_id"):
                items.append(parsed)
        return items

    # Single video or Shorts
    parsed = parse_video_item(info)
    if parsed.get("video_id"):
        return [parsed]
    return []
