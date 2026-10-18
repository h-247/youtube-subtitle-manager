import logging
import os
import re
from contextlib import asynccontextmanager
from typing import Any
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import settings
from app.database import engine, Base
from app.api import api_router

SENSITIVE_PARAM_PATTERN = re.compile(
    r"(^|[?&])(code|access_token|refresh_token|client_secret|token|secret|id_token)=([^&#\s]*)",
    re.IGNORECASE,
)


def redact_query_text(text: str) -> str:
    """Redacts sensitive OAuth codes and credentials in query strings or log text."""
    if not text:
        return text
    return SENSITIVE_PARAM_PATTERN.sub(r"\1\2=[REDACTED]", text)


def redact_query_bytes(query_bytes: bytes) -> bytes:
    """Redacts sensitive parameters from raw query string bytes."""
    if not query_bytes:
        return query_bytes
    decoded = query_bytes.decode("latin1", errors="replace")
    return redact_query_text(decoded).encode("latin1")


class OAuthLogRedactionFilter(logging.Filter):
    """
    Logging filter that redacts OAuth authorization codes and sensitive parameters
    from Uvicorn access log records before emission.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if record.args:
            if isinstance(record.args, tuple):
                new_args = []
                for arg in record.args:
                    if isinstance(arg, str):
                        new_args.append(redact_query_text(arg))
                    else:
                        new_args.append(arg)
                record.args = tuple(new_args)
            elif isinstance(record.args, list):
                for idx, arg in enumerate(record.args):
                    if isinstance(arg, str):
                        record.args[idx] = redact_query_text(arg)
            elif isinstance(record.args, dict):
                for k, v in record.args.items():
                    if isinstance(v, str):
                        record.args[k] = redact_query_text(v)

        if isinstance(record.msg, str):
            record.msg = redact_query_text(record.msg)

        if hasattr(record, "message") and isinstance(record.message, str):
            record.message = redact_query_text(record.message)

        if "color_message" in record.__dict__ and isinstance(record.__dict__["color_message"], str):
            record.__dict__["color_message"] = redact_query_text(record.__dict__["color_message"])

        return True


def configure_uvicorn_access_redaction() -> None:
    """Installs the redaction filter onto the 'uvicorn.access' logger and existing handlers."""
    access_logger = logging.getLogger("uvicorn.access")
    redaction_filter = OAuthLogRedactionFilter()

    if not any(isinstance(f, OAuthLogRedactionFilter) for f in access_logger.filters):
        access_logger.addFilter(redaction_filter)

    for handler in access_logger.handlers:
        if not any(isinstance(f, OAuthLogRedactionFilter) for f in handler.filters):
            handler.addFilter(redaction_filter)


class OAuthAccessLogRedactionMiddleware:
    """
    ASGI middleware ensuring that sensitive OAuth parameters (e.g. authorization codes)
    in scope['query_string'] are redacted before Uvicorn's access logger records the request line.
    """

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        configure_uvicorn_access_redaction()

        def _redact_scope() -> None:
            if scope.get("query_string"):
                scope["query_string"] = redact_query_bytes(scope["query_string"])

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                _redact_scope()
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            _redact_scope()


# Configure access redaction at module import time
configure_uvicorn_access_redaction()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure server access logs redact OAuth authorization codes
    configure_uvicorn_access_redaction()
    # Ensure local subtitles storage directory exists
    os.makedirs(settings.SUBTITLE_STORAGE_DIR, exist_ok=True)
    # Auto-create tables for development / SQLite test mode
    from app.models.channel_tag import ChannelTag  # ensure model is registered
    Base.metadata.create_all(bind=engine)
    try:
        with engine.begin() as conn:
            if "sqlite" in str(engine.url):
                res = conn.exec_driver_sql("PRAGMA table_info(videos)")
                cols = [r[1] for r in res.fetchall()]
                if cols:
                    if "channel_url" not in cols:
                        conn.exec_driver_sql("ALTER TABLE videos ADD COLUMN channel_url VARCHAR(512)")
                    if "watch_status" not in cols:
                        conn.exec_driver_sql("ALTER TABLE videos ADD COLUMN watch_status VARCHAR(32) DEFAULT 'TO_DO' NOT NULL")
                    if "channel_tags" not in cols:
                        conn.exec_driver_sql("ALTER TABLE videos ADD COLUMN channel_tags VARCHAR(256)")
                    if "subtitle_text" not in cols:
                        conn.exec_driver_sql("ALTER TABLE videos ADD COLUMN subtitle_text TEXT")
                    conn.exec_driver_sql("UPDATE videos SET watch_status = status, status = 'COMPLETED' WHERE status IN ('TO_DO', 'DOING', 'DONE')")
                user_cols = [r[1] for r in conn.exec_driver_sql("PRAGMA table_info(users)").fetchall()]
                if user_cols and "sites_sync_token" not in user_cols:
                    conn.exec_driver_sql("ALTER TABLE users ADD COLUMN sites_sync_token TEXT")
                if user_cols and "sites_user_id" not in user_cols:
                    conn.exec_driver_sql("ALTER TABLE users ADD COLUMN sites_user_id VARCHAR(255)")
                if user_cols:
                    conn.exec_driver_sql(
                        "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_sites_user_id ON users (sites_user_id)"
                    )
    except Exception:
        pass
    from app.services.durable_jobs import JobRunner
    runner = JobRunner()
    runner.start()
    try:
        yield
    finally:
        runner.stop()


app = FastAPI(
    title=settings.PROJECT_NAME,
    version="1.0.0",
    description="Local-first YouTube Subtitle Manager API with PostgreSQL, yt-dlp, and Google Drive upload.",
    lifespan=lifespan,
)

# CORS configuration
origins = [
    settings.FRONTEND_URL,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "*",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(OAuthAccessLogRedactionMiddleware)

app.include_router(api_router)


@app.get("/health", tags=["health"])
def health_check():
    return {
        "status": "healthy",
        "environment": settings.ENVIRONMENT,
        "drive_configured": bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET),
    }


@app.get("/", tags=["root"])
def root():
    return {
        "message": "Welcome to YouTube Subtitle Manager API",
        "docs_url": "/docs",
        "health_url": "/health",
    }
