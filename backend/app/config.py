import os
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    PROJECT_NAME: str = "YouTube Subtitle Manager"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    DOWNLOAD_CONCURRENCY: int = 2

    # Database
    DATABASE_URL: str = "sqlite:///./youtube_subtitles.db"

    # Security
    SECRET_KEY: str = "super-secret-jwt-key-change-in-production-min-32-chars-long"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days

    # Google Drive OAuth & API
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/drive/callback"
    GOOGLE_DRIVE_FOLDER_NAME: str = "YouTube Subtitles"

    # Frontend URL for CORS & OAuth redirects
    FRONTEND_URL: str = "http://localhost:3000"

    # Subtitles Local Temporary Storage
    SUBTITLE_STORAGE_DIR: str = os.path.join(os.path.dirname(os.path.dirname(__file__)), "temp_subtitles")

    # YouTube Subtitle Rate Limiting (HTTP 429) & Retry Configuration
    SUBTITLE_MAX_RETRIES: int = 3
    SUBTITLE_RETRY_DELAY: float = 1.0
    SUBTITLE_RETRY_BACKOFF_FACTOR: float = 2.0
    SUBTITLE_RETRY_ATTEMPTS: Optional[int] = None
    SUBTITLE_RETRY_BACKOFF_DELAY: Optional[float] = None

    # YouTube Cookies Configuration (avoids HTTP 429 rate limiting)
    # Path to Netscape format cookies.txt file (recommended for Windows/Chromium)
    YTDLP_COOKIES_FILE: Optional[str] = "cookies.txt"
    # Optional browser-exported cookie JSON. Materialized as a private temp file at runtime.
    YTDLP_COOKIES_JSON: Optional[str] = None
    # Optional browser name for direct extraction, e.g. "brave", "chrome", "firefox"
    YTDLP_COOKIES_FROM_BROWSER: Optional[str] = None

    # Shared secret used only by the ChatGPT Sites subtitle proxy endpoint.
    SUBTITLE_BACKEND_TOKEN: Optional[str] = None

    # Sites library that receives local metadata and downloaded subtitles.
    SITES_SYNC_URL: str = "https://youtube-subtitle-manager.h-247.chatgpt.site"
    # Service credential for accessing a private ChatGPT Site from this local backend.
    SITES_SERVICE_TOKEN: str = ""


settings = Settings()
