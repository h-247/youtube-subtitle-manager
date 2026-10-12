from unittest.mock import patch
from app.services.youtube_service import (
    extract_video_id,
    is_playlist_url,
    extract_items_from_url,
)


def test_extract_video_id_formats():
    assert extract_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_video_id("https://youtu.be/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_video_id("https://www.youtube.com/shorts/3JZ_D3ELwOQ") == "3JZ_D3ELwOQ"
    assert extract_video_id("https://www.youtube.com/embed/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s") == "dQw4w9WgXcQ"
    assert extract_video_id("not-a-valid-url") is None


def test_is_playlist_url():
    assert is_playlist_url("https://www.youtube.com/playlist?list=PL1234567890abcdef") is True
    assert is_playlist_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890abcdef") is True
    assert is_playlist_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ") is False
    assert is_playlist_url("https://www.youtube.com/shorts/3JZ_D3ELwOQ") is False


@patch("app.services.youtube_service.extract_metadata")
def test_extract_items_single_video(mock_extract):
    mock_extract.return_value = {
        "id": "dQw4w9WgXcQ",
        "title": "Never Gonna Give You Up",
        "uploader": "Rick Astley",
        "duration": 212,
        "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
        "webpage_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    }

    items = extract_items_from_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    assert len(items) == 1
    assert items[0]["video_id"] == "dQw4w9WgXcQ"
    assert items[0]["title"] == "Never Gonna Give You Up"
    assert items[0]["channel_title"] == "Rick Astley"
    assert items[0]["duration"] == 212


@patch("app.services.youtube_service.extract_metadata")
def test_extract_items_playlist(mock_extract):
    mock_extract.return_value = {
        "id": "PL12345",
        "title": "My Favorite Tracks",
        "entries": [
            {
                "id": "vid001",
                "title": "Track 1",
                "uploader": "Artist 1",
                "duration": 180,
                "thumbnail": "https://thumb/1.jpg",
                "webpage_url": "https://www.youtube.com/watch?v=vid001",
            },
            {
                "id": "vid002",
                "title": "Track 2",
                "uploader": "Artist 2",
                "duration": 240,
                "thumbnail": "https://thumb/2.jpg",
                "webpage_url": "https://www.youtube.com/watch?v=vid002",
            },
        ],
    }

    items = extract_items_from_url("https://www.youtube.com/playlist?list=PL12345")
    assert len(items) == 2
    assert items[0]["video_id"] == "vid001"
    assert items[1]["video_id"] == "vid002"
    assert items[0]["title"] == "Track 1"
    assert items[1]["title"] == "Track 2"


def test_get_ydl_cookie_opts_file(tmp_path):
    import tempfile
    from app.services.youtube_service import get_ydl_cookie_opts
    from app.config import settings

    with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as f:
        f.write(b"# Netscape HTTP Cookie File\n")
        f_name = f.name

    original_file = settings.YTDLP_COOKIES_FILE
    try:
        settings.YTDLP_COOKIES_FILE = f_name
        opts = get_ydl_cookie_opts()
        assert opts.get("cookiefile") == f_name
    finally:
        settings.YTDLP_COOKIES_FILE = original_file
        import os
        if os.path.exists(f_name):
            os.remove(f_name)


def test_get_ydl_cookie_opts_browser():
    from app.services.youtube_service import get_ydl_cookie_opts
    from app.config import settings

    original_browser = settings.YTDLP_COOKIES_FROM_BROWSER
    original_file = settings.YTDLP_COOKIES_FILE
    try:
        settings.YTDLP_COOKIES_FILE = "non_existent_file.txt"
        settings.YTDLP_COOKIES_FROM_BROWSER = "brave"
        opts = get_ydl_cookie_opts()
        assert opts.get("cookiesfrombrowser") == ("brave", None, None, None)
    finally:
        settings.YTDLP_COOKIES_FROM_BROWSER = original_browser
        settings.YTDLP_COOKIES_FILE = original_file

