"""One-shot GitHub runner probe; do not print or publish caption contents."""

import os
import re
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

from yt_dlp import YoutubeDL


video_id = os.environ.get("VIDEO_ID", "").strip()
if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
    raise SystemExit("VIDEO_ID must be an 11-character YouTube video ID.")

with TemporaryDirectory() as temporary_directory:
    output_dir = Path(temporary_directory)
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
    print(f"Probing English captions for video {video_id} on GitHub Actions.", flush=True)
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
