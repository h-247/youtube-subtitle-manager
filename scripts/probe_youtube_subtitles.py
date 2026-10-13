"""One-shot GitHub runner probe; do not print or publish caption contents."""

import os
import json
import re
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

from yt_dlp import YoutubeDL


video_id = os.environ.get("VIDEO_ID", "").strip()
if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
    raise SystemExit("VIDEO_ID must be an 11-character YouTube video ID.")
player_client = os.environ.get("PLAYER_CLIENT", "default").strip()
if player_client not in {"default", "web_embedded"}:
    raise SystemExit("Unsupported YouTube player client.")

with TemporaryDirectory() as temporary_directory:
    output_dir = Path(temporary_directory)
    cookie_json = os.environ.get("YOUTUBE_COOKIE_JSON", "").strip()
    options = {
        "noplaylist": True,
        "skip_download": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitleslangs": [r"en(?:$|[-_].*)"],
        "subtitlesformat": "vtt",
        "outtmpl": str(output_dir / "%(id)s.%(ext)s"),
        "retries": 1,
        "extractor_retries": 1,
        "socket_timeout": 20,
        "noprogress": True,
    }
    if player_client != "default":
        options["extractor_args"] = {"youtube": {"player_client": [player_client]}}
    if cookie_json:
        try:
            entries = json.loads(cookie_json)
            if not isinstance(entries, list):
                raise ValueError("Cookie secret must be a JSON array.")
            cookie_lines = ["# Netscape HTTP Cookie File"]
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                name = entry.get("name")
                value = entry.get("value")
                domain = entry.get("domain")
                if (
                    not isinstance(name, str)
                    or not isinstance(value, str)
                    or not isinstance(domain, str)
                    or domain.lstrip(".").lower() != "youtube.com"
                    or not re.fullmatch(r"[A-Za-z0-9_\-]+", name)
                    or any(character in value for character in "\r\n\t")
                ):
                    continue
                expires = int(entry.get("expirationDate") or 0)
                cookie_domain = "#HttpOnly_" + domain if entry.get("httpOnly") else domain
                cookie_lines.append(
                    "\t".join((
                        cookie_domain,
                        "TRUE" if domain.startswith(".") else "FALSE",
                        "/",
                        "TRUE" if entry.get("secure") else "FALSE",
                        str(expires),
                        name,
                        value,
                    ))
                )
            if len(cookie_lines) == 1:
                raise ValueError("Cookie secret has no usable youtube.com entries.")
            cookie_file = output_dir / "cookies.txt"
            cookie_file.write_text("\n".join(cookie_lines) + "\n", encoding="utf-8")
            cookie_file.chmod(0o600)
            options["cookiefile"] = str(cookie_file)
            print(f"Loaded {len(cookie_lines) - 1} YouTube cookies from an Actions secret.", flush=True)
        except (ValueError, TypeError, OverflowError, json.JSONDecodeError) as error:
            raise SystemExit(f"Invalid YouTube cookie secret: {type(error).__name__}") from None
    print(f"Probing English captions for video {video_id} with {player_client} on GitHub Actions.", flush=True)
    try:
        with YoutubeDL(options) as downloader:
            info = downloader.extract_info(
                f"https://www.youtube.com/watch?v={video_id}", download=True
            )
    except Exception as error:
        print(f"Probe failed: {type(error).__name__}: {error}", file=sys.stderr)
        raise SystemExit(1) from None

    files = [path for path in output_dir.glob(f"{video_id}*.vtt") if path.stat().st_size > 0]
    if not files:
        manual = sum(code.startswith("en") for code in (info or {}).get("subtitles", {}))
        automatic = sum(code.startswith("en") for code in (info or {}).get("automatic_captions", {}))
        raise SystemExit(
            f"No English VTT was written (manual English tracks: {manual}; "
            f"automatic or translated English tracks: {automatic})."
        )

    for path in files:
        print(f"SUCCESS: {path.name} ({path.stat().st_size} bytes)")
