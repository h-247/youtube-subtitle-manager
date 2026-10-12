from unittest.mock import patch, MagicMock
from app.services.subtitle_service import select_english_subtitle, download_subtitles


def test_select_english_prefers_manual_over_auto():
    subtitles = {"en": [{"ext": "vtt", "url": "http://manual.vtt"}]}
    auto_subtitles = {"en": [{"ext": "vtt", "url": "http://auto.vtt"}]}

    lang, sub_type = select_english_subtitle(subtitles, auto_subtitles)
    assert lang == "en"
    assert sub_type == "MANUAL"


def test_select_english_falls_back_to_auto():
    subtitles = {"es": [{"ext": "vtt"}]}  # Spanish manual only
    auto_subtitles = {"en": [{"ext": "vtt"}]}  # English auto

    lang, sub_type = select_english_subtitle(subtitles, auto_subtitles)
    assert lang == "en"
    assert sub_type == "AUTO"


def test_select_english_handles_variants():
    # e.g. en-US manual
    subtitles = {"en-US": [{"ext": "vtt"}]}
    auto_subtitles = {"en": [{"ext": "vtt"}]}

    lang, sub_type = select_english_subtitle(subtitles, auto_subtitles)
    assert lang == "en-US"
    assert sub_type == "MANUAL"


def test_select_english_no_english_subtitles():
    subtitles = {"fr": [{"ext": "vtt"}]}
    auto_subtitles = {"de": [{"ext": "vtt"}]}

    lang, sub_type = select_english_subtitle(subtitles, auto_subtitles)
    assert lang is None
    assert sub_type == "NONE"


def test_select_english_empty_subtitles():
    lang, sub_type = select_english_subtitle({}, {})
    assert lang is None
    assert sub_type == "NONE"


@patch("yt_dlp.YoutubeDL")
def test_download_subtitles_no_subtitles_handles_gracefully(mock_ydl_cls):
    mock_ydl = MagicMock()
    mock_ydl.extract_info.return_value = {
        "subtitles": {},
        "automatic_captions": {},
    }
    mock_ydl_cls.return_value.__enter__.return_value = mock_ydl

    result = download_subtitles("vid_no_subs", "https://youtube.com/watch?v=vid_no_subs")
    assert result["status"] == "NO_SUBTITLES"
    assert result["subtitle_type"] == "NONE"
    assert result["file_path"] is None


@patch("yt_dlp.YoutubeDL")
def test_download_subtitles_failure_handles_without_crashing(mock_ydl_cls):
    mock_ydl = MagicMock()
    mock_ydl.extract_info.side_effect = Exception("YouTube connection error: 403 Forbidden")
    mock_ydl_cls.return_value.__enter__.return_value = mock_ydl

    # Must NOT raise unhandled exception
    result = download_subtitles("vid_fail", "https://youtube.com/watch?v=vid_fail")
    assert result["status"] == "FAILED"
    assert result["subtitle_type"] == "NONE"
    assert "403 Forbidden" in result["error_message"]


@patch("time.sleep")
@patch("glob.glob")
@patch("yt_dlp.YoutubeDL")
def test_download_subtitles_429_retries_and_succeeds(mock_ydl_cls, mock_glob, mock_sleep):
    mock_ydl = MagicMock()
    mock_ydl.extract_info.return_value = {
        "subtitles": {"en": [{"ext": "vtt"}]},
        "automatic_captions": {},
    }
    # Fails first with 429, succeeds on retry
    mock_ydl.download.side_effect = [Exception("HTTP Error 429: Too Many Requests"), None]
    mock_ydl_cls.return_value.__enter__.return_value = mock_ydl
    mock_glob.return_value = ["/mock/path/vid_retry.vtt"]

    result = download_subtitles("vid_retry", "https://youtube.com/watch?v=vid_retry")

    assert result["status"] == "COMPLETED"
    assert result["subtitle_type"] == "MANUAL"
    assert result["subtitle_language"] == "en"
    assert result["file_path"] == "/mock/path/vid_retry.vtt"
    assert mock_ydl.download.call_count == 2
    assert mock_sleep.call_count == 1
    assert mock_sleep.call_args[0][0] == 1.0


@patch("time.sleep")
@patch("yt_dlp.YoutubeDL")
def test_download_subtitles_429_exhausts_retries_and_returns_actionable_error(mock_ydl_cls, mock_sleep):
    mock_ydl = MagicMock()
    mock_ydl.extract_info.return_value = {
        "subtitles": {"en": [{"ext": "vtt"}]},
        "automatic_captions": {},
    }
    mock_ydl.download.side_effect = Exception("HTTP Error 429: Too Many Requests")
    mock_ydl_cls.return_value.__enter__.return_value = mock_ydl

    result = download_subtitles("vid_exhaust", "https://youtube.com/watch?v=vid_exhaust", max_retries=3, retry_delay=1.0)

    assert result["status"] == "FAILED"
    assert result["subtitle_type"] == "MANUAL"
    assert result["file_path"] is None
    # 1 initial try + 3 retries = 4 download calls
    assert mock_ydl.download.call_count == 4
    # 3 sleeps with exponential backoff: 1.0, 2.0, 4.0
    assert mock_sleep.call_count == 3
    sleep_durations = [call[0][0] for call in mock_sleep.call_args_list]
    assert sleep_durations == [1.0, 2.0, 4.0]

    # Actionable user-facing rate-limit message checks (AC2)
    err = result["error_message"]
    assert err is not None
    assert "429" in err
    assert "rate limit" in err.lower()
    assert "wait" in err.lower()
    assert "retry" in err.lower()
    # Ensure no cookies, bypass, or proxy language
    for forbidden in ["cookie", "proxy", "bypass", "account", "login", "auth"]:
        assert forbidden not in err.lower()


@patch("time.sleep")
@patch("yt_dlp.YoutubeDL")
def test_download_subtitles_non_429_failure_does_not_retry(mock_ydl_cls, mock_sleep):
    mock_ydl = MagicMock()
    mock_ydl.extract_info.return_value = {
        "subtitles": {"en": [{"ext": "vtt"}]},
        "automatic_captions": {},
    }
    mock_ydl.download.side_effect = Exception("Connection reset by peer: 504 Gateway Timeout")
    mock_ydl_cls.return_value.__enter__.return_value = mock_ydl

    result = download_subtitles("vid_non_429", "https://youtube.com/watch?v=vid_non_429")

    assert result["status"] == "FAILED"
    assert mock_ydl.download.call_count == 1
    assert mock_sleep.call_count == 0
    assert "504 Gateway Timeout" in result["error_message"]


@patch("time.sleep")
@patch("yt_dlp.YoutubeDL")
def test_download_subtitles_custom_retry_configuration(mock_ydl_cls, mock_sleep):
    mock_ydl = MagicMock()
    mock_ydl.extract_info.return_value = {
        "subtitles": {"en": [{"ext": "vtt"}]},
        "automatic_captions": {},
    }
    mock_ydl.download.side_effect = Exception("HTTP Error 429: Too Many Requests")
    mock_ydl_cls.return_value.__enter__.return_value = mock_ydl

    # Configure bounded retries = 1, delay = 0.5s
    result = download_subtitles("vid_custom", "https://youtube.com/watch?v=vid_custom", max_retries=1, retry_delay=0.5)

    assert result["status"] == "FAILED"
    assert mock_ydl.download.call_count == 2  # 1 initial + 1 retry
    assert mock_sleep.call_count == 1
    assert mock_sleep.call_args[0][0] == 0.5


@patch("time.sleep")
@patch("yt_dlp.YoutubeDL")
def test_download_subtitles_429_during_metadata_extraction(mock_ydl_cls, mock_sleep):
    mock_ydl = MagicMock()
    mock_ydl.extract_info.side_effect = Exception("HTTP Error 429: Too Many Requests")
    mock_ydl_cls.return_value.__enter__.return_value = mock_ydl

    result = download_subtitles("vid_meta_429", "https://youtube.com/watch?v=vid_meta_429", max_retries=2, retry_delay=1.0)

    assert result["status"] == "FAILED"
    assert mock_ydl.extract_info.call_count == 3  # 1 initial + 2 retries
    assert mock_sleep.call_count == 2
    assert "rate limit" in result["error_message"].lower()
