import json
import logging
import os
import tempfile
import pytest
from unittest.mock import patch, MagicMock
from oauthlib.oauth2.rfc6749.errors import InvalidGrantError, InvalidClientError
from app.services.drive_service import GoogleDriveService
from app.main import (
    OAuthLogRedactionFilter,
    OAuthAccessLogRedactionMiddleware,
    redact_query_text,
    redact_query_bytes,
    configure_uvicorn_access_redaction,
    app,
)


def test_drive_service_is_configured():
    service = GoogleDriveService()
    service.client_id = "test-client-id"
    service.client_secret = "test-client-secret"
    assert service.is_configured() is True

    service.client_id = ""
    assert service.is_configured() is False


def test_drive_auth_url_generation():
    service = GoogleDriveService()
    service.client_id = "client-id-123"
    service.client_secret = "client-secret-123"

    with patch("google_auth_oauthlib.flow.Flow.from_client_config") as mock_flow_cls:
        mock_flow = MagicMock()
        mock_flow.authorization_url.return_value = ("https://accounts.google.com/o/oauth2/auth?test=1", "state123")
        mock_flow_cls.return_value = mock_flow

        auth_url, state = service.get_authorization_url(state="user-42")
        assert "accounts.google.com" in auth_url
        assert state == "state123"


def test_drive_callback_opened_directly_redirects_to_dashboard(client):
    """The OAuth redirect URL should never expose a raw validation error."""
    response = client.get("/api/drive/callback", follow_redirects=False)

    assert response.status_code == 307
    assert response.headers["location"] == (
        "http://localhost:3000/dashboard?"
        "drive_error=Start+Google+Drive+connection+from+the+dashboard."
    )


def test_drive_callback_provider_denial_redirects_to_dashboard(client):
    """OAuth provider cancellation/denial should safely redirect to the dashboard."""
    response = client.get("/api/drive/callback?error=access_denied", follow_redirects=False)

    assert response.status_code == 307
    assert response.headers["location"] == (
        "http://localhost:3000/dashboard?"
        "drive_error=Google+Drive+authorization+was+cancelled+or+denied."
    )


def test_drive_callback_invalid_state_redirects_to_dashboard(client):
    """Callback with missing or invalid numeric state should safely redirect."""
    response = client.get("/api/drive/callback?code=mock-code&state=invalid-state", follow_redirects=False)

    assert response.status_code == 307
    assert response.headers["location"] == (
        "http://localhost:3000/dashboard?"
        "drive_error=Google+Drive+authorization+could+not+be+verified.+Please+try+again."
    )


def test_drive_callback_token_exchange_failure_diagnoses_safely_and_redirects(
    client, user_a, db_session, caplog
):
    """
    When token exchange fails (e.g. invalid_grant):
    - Safe server-side structured diagnostic is logged with provider error class
    - No codes, tokens, or secrets are exposed in logs
    - User is redirected to dashboard with actionable configuration error
    - No credentials are saved to user record
    """
    mock_error = InvalidGrantError(description="Code expired or invalid")
    secret_code = "sensitive-oauth-auth-code-12345"

    with caplog.at_level(logging.ERROR), patch(
        "app.api.drive.drive_service.exchange_code_for_tokens", side_effect=mock_error
    ):
        response = client.get(
            f"/api/drive/callback?code={secret_code}&state={user_a.id}",
            follow_redirects=False,
        )

    assert response.status_code == 307
    assert response.headers["location"] == (
        "http://localhost:3000/dashboard?"
        "drive_error=Google+Drive+configuration+or+token+exchange+failed.+Please+verify+server+OAuth+settings."
    )

    # Verify user credentials were NOT persisted
    db_session.refresh(user_a)
    assert user_a.drive_credentials is None

    # Verify logs: structured diagnostic logged provider error class, and NEVER sensitive code
    assert "invalid_grant" in caplog.text
    assert secret_code not in caplog.text


def test_drive_callback_token_exchange_invalid_client_diagnoses_safely(
    client, user_a, db_session, caplog
):
    """Ensure invalid_client error class is safely logged without leaking sensitive details."""
    mock_error = InvalidClientError(description="The OAuth client was not found")
    secret_code = "secret-code-xyz"

    with caplog.at_level(logging.ERROR), patch(
        "app.api.drive.drive_service.exchange_code_for_tokens", side_effect=mock_error
    ):
        response = client.get(
            f"/api/drive/callback?code={secret_code}&state={user_a.id}",
            follow_redirects=False,
        )

    assert response.status_code == 307
    assert response.headers["location"] == (
        "http://localhost:3000/dashboard?"
        "drive_error=Google+Drive+configuration+or+token+exchange+failed.+Please+verify+server+OAuth+settings."
    )

    db_session.refresh(user_a)
    assert user_a.drive_credentials is None

    assert "invalid_client" in caplog.text
    assert secret_code not in caplog.text


def test_drive_callback_token_exchange_success_persists_credentials(
    client, user_a, db_session
):
    """
    When token exchange succeeds:
    - Credentials are persisted to the user record
    - User is redirected to dashboard with drive_connected=true
    """
    mock_tokens = {
        "token": "test-access-token-abc",
        "refresh_token": "test-refresh-token-xyz",
        "token_uri": "https://oauth2.googleapis.com/token",
        "client_id": "test-client-id",
        "client_secret": "test-client-secret",
        "scopes": ["https://www.googleapis.com/auth/drive.file"],
    }

    with patch(
        "app.api.drive.drive_service.exchange_code_for_tokens", return_value=mock_tokens
    ):
        response = client.get(
            f"/api/drive/callback?code=mock-valid-code&state={user_a.id}",
            follow_redirects=False,
        )

    assert response.status_code == 307
    assert response.headers["location"] == "http://localhost:3000/dashboard?drive_connected=true"

    # Verify credentials persisted in user record
    db_session.refresh(user_a)
    assert user_a.drive_credentials is not None
    saved_creds = json.loads(user_a.drive_credentials)
    assert saved_creds["token"] == "test-access-token-abc"
    assert saved_creds["refresh_token"] == "test-refresh-token-xyz"


def test_upload_subtitle_success_and_deletes_temp_file_only_after_upload():
    service = GoogleDriveService()
    service.client_id = "test-client"
    service.client_secret = "test-secret"

    # Create temporary file and close it so other handles can access it
    tf = tempfile.NamedTemporaryFile(suffix=".vtt", delete=False)
    tf.write(b"WEBVTT\n00:00:00.000 --> 00:00:02.000\nHello World")
    tf.close()
    temp_file_path = tf.name

    try:
        assert os.path.exists(temp_file_path)

        mock_drive_api = MagicMock()
        mock_files = MagicMock()
        mock_create = MagicMock()
        mock_create.execute.return_value = {
            "id": "drive-file-id-999",
            "webViewLink": "https://drive.google.com/file/d/drive-file-id-999/view",
        }
        mock_files.create.return_value = mock_create
        mock_drive_api.files.return_value = mock_files

        with patch.object(service, "get_service_from_credentials", return_value=mock_drive_api), \
             patch.object(service, "get_or_create_folder", return_value="folder-abc"):

            creds = {"token": "fake-token", "refresh_token": "fake-refresh"}
            result = service.upload_subtitle(
                file_path=temp_file_path,
                title="My Test Video",
                credentials_data=creds,
                delete_on_success=True,
            )

            assert result["drive_file_id"] == "drive-file-id-999"
            assert result["drive_file_url"] == "https://drive.google.com/file/d/drive-file-id-999/view"

            # Confirmed upload: file must have been deleted
            assert not os.path.exists(temp_file_path)
    finally:
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)


def test_upload_subtitle_failure_preserves_temp_file():
    service = GoogleDriveService()
    service.client_id = "test-client"
    service.client_secret = "test-secret"

    # Create temporary file and close it so other handles can access it
    tf = tempfile.NamedTemporaryFile(suffix=".vtt", delete=False)
    tf.write(b"WEBVTT\n00:00:00.000 --> 00:00:02.000\nHello World")
    tf.close()
    temp_file_path = tf.name

    try:
        assert os.path.exists(temp_file_path)

        mock_drive_api = MagicMock()
        mock_files = MagicMock()
        mock_create = MagicMock()
        # Simulate upload error (e.g. network error, quota exceeded)
        mock_create.execute.side_effect = RuntimeError("Drive storage quota exceeded")
        mock_files.create.return_value = mock_create
        mock_drive_api.files.return_value = mock_files

        with patch.object(service, "get_service_from_credentials", return_value=mock_drive_api), \
             patch.object(service, "get_or_create_folder", return_value="folder-abc"):

            creds = {"token": "fake-token"}
            with pytest.raises(RuntimeError):
                service.upload_subtitle(
                    file_path=temp_file_path,
                    title="Failed Video",
                    credentials_data=creds,
                    delete_on_success=True,
                )

            # Failure occurred: temporary file MUST NOT be deleted!
            assert os.path.exists(temp_file_path)
    finally:
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)


@pytest.mark.asyncio
async def test_oauth_callback_access_log_redaction_live_server_path(user_a, db_session):
    """
    Live Uvicorn access logging path:
    Ensure that when a callback request arrives with a sensitive OAuth code,
    Uvicorn's access log records 'code=[REDACTED]' and the raw authorization code
    is completely absent from server logs, while token exchange and credential
    persistence proceed successfully.
    """
    import io
    from uvicorn.config import Config
    from uvicorn.server import ServerState
    from uvicorn.protocols.http.h11_impl import H11Protocol
    from uvicorn.logging import AccessFormatter
    from app.database import get_db

    secret_auth_code = "live-secret-oauth-auth-code-99999"
    mock_tokens = {
        "token": "test-access-token-live",
        "refresh_token": "test-refresh-token-live",
        "token_uri": "https://oauth2.googleapis.com/token",
        "client_id": "test-client-id",
        "client_secret": "test-client-secret",
        "scopes": ["https://www.googleapis.com/auth/drive.file"],
    }

    log_stream = io.StringIO()
    handler = logging.StreamHandler(log_stream)
    handler.setFormatter(AccessFormatter(use_colors=False))
    access_logger = logging.getLogger("uvicorn.access")
    access_logger.handlers.clear()
    access_logger.addHandler(handler)
    access_logger.setLevel(logging.INFO)

    class DummySocket:
        def getsockname(self):
            return ("127.0.0.1", 8000)

        def getpeername(self):
            return ("127.0.0.1", 54321)

    class DummyTransport:
        def get_extra_info(self, name):
            if name == "socket":
                return DummySocket()
            return None

        def write(self, data):
            pass

        def close(self):
            pass

        def pause_reading(self):
            pass

        def resume_reading(self):
            pass

        def is_closing(self):
            return False

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    try:
        cfg = Config(app=app)
        access_logger.handlers.clear()
        access_logger.addHandler(handler)
        configure_uvicorn_access_redaction()

        protocol = H11Protocol(cfg, ServerState(), {})
        protocol.connection_made(DummyTransport())

        with patch("app.api.drive.drive_service.exchange_code_for_tokens", return_value=mock_tokens):
            raw_request = (
                f"GET /api/drive/callback?code={secret_auth_code}&state={user_a.id} HTTP/1.1\r\n"
                f"Host: localhost\r\n\r\n"
            ).encode("latin1")
            protocol.data_received(raw_request)
            import asyncio
            await asyncio.sleep(0.1)

        log_output = log_stream.getvalue()
        # AC1: raw code MUST NOT appear in server access logs
        assert secret_auth_code not in log_output
        # AC1: code query parameter MUST be redacted
        assert "code=[REDACTED]" in log_output
        # Non-sensitive query parameters (e.g. state) are preserved
        assert f"state={user_a.id}" in log_output
        assert "307" in log_output

        # AC2: Callback success and credential persistence behavior preserved
        db_session.refresh(user_a)
        assert user_a.drive_credentials is not None
        saved_creds = json.loads(user_a.drive_credentials)
        assert saved_creds["token"] == "test-access-token-live"
    finally:
        app.dependency_overrides.clear()
        access_logger.handlers.clear()


@pytest.mark.asyncio
async def test_oauth_callback_access_log_redaction_on_exchange_failure(user_a, db_session, caplog):
    """
    When token exchange fails on live server path:
    - Raw authorization code is absent from server access logs
    - Raw code is absent from application error logs
    - Code is redacted in access logs as code=[REDACTED]
    - Safe provider error diagnostic is logged
    - No credentials saved
    """
    import io
    from uvicorn.config import Config
    from uvicorn.server import ServerState
    from uvicorn.protocols.http.h11_impl import H11Protocol
    from uvicorn.logging import AccessFormatter
    from app.database import get_db

    secret_auth_code = "failing-secret-oauth-code-44444"
    mock_error = InvalidGrantError(description="Code expired or invalid")

    log_stream = io.StringIO()
    handler = logging.StreamHandler(log_stream)
    handler.setFormatter(AccessFormatter(use_colors=False))
    access_logger = logging.getLogger("uvicorn.access")
    access_logger.handlers.clear()
    access_logger.addHandler(handler)
    access_logger.setLevel(logging.INFO)

    class DummySocket:
        def getsockname(self):
            return ("127.0.0.1", 8000)

        def getpeername(self):
            return ("127.0.0.1", 54321)

    class DummyTransport:
        def get_extra_info(self, name):
            if name == "socket":
                return DummySocket()
            return None

        def write(self, data):
            pass

        def close(self):
            pass

        def pause_reading(self):
            pass

        def resume_reading(self):
            pass

        def is_closing(self):
            return False

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    try:
        cfg = Config(app=app)
        access_logger.handlers.clear()
        access_logger.addHandler(handler)
        configure_uvicorn_access_redaction()

        protocol = H11Protocol(cfg, ServerState(), {})
        protocol.connection_made(DummyTransport())

        with caplog.at_level(logging.ERROR), patch(
            "app.api.drive.drive_service.exchange_code_for_tokens", side_effect=mock_error
        ):
            raw_request = (
                f"GET /api/drive/callback?code={secret_auth_code}&state={user_a.id} HTTP/1.1\r\n"
                f"Host: localhost\r\n\r\n"
            ).encode("latin1")
            protocol.data_received(raw_request)
            import asyncio
            await asyncio.sleep(0.1)

        log_output = log_stream.getvalue()
        # Check access logs: code is redacted, secret is absent
        assert secret_auth_code not in log_output
        assert "code=[REDACTED]" in log_output
        assert f"state={user_a.id}" in log_output

        # Check application error logs: safe structured diagnostic, code absent
        assert secret_auth_code not in caplog.text
        assert "invalid_grant" in caplog.text

        # Verify no credentials saved
        db_session.refresh(user_a)
        assert user_a.drive_credentials is None
    finally:
        app.dependency_overrides.clear()
        access_logger.handlers.clear()


def test_oauth_log_redaction_filter_unit():
    """Unit test for OAuthLogRedactionFilter across various log record structures."""
    filter_obj = OAuthLogRedactionFilter()

    # 1. Standard Uvicorn access log tuple args
    record = logging.LogRecord(
        name="uvicorn.access",
        level=logging.INFO,
        pathname="",
        lineno=0,
        msg='%s - "%s %s HTTP/%s" %d',
        args=("127.0.0.1:54321", "GET", "/api/drive/callback?code=super-secret-code&state=123", "1.1", 307),
        exc_info=None,
    )
    assert filter_obj.filter(record) is True
    assert record.args[2] == "/api/drive/callback?code=[REDACTED]&state=123"
    assert "super-secret-code" not in str(record.args)

    # 2. Pre-formatted message string
    record_msg = logging.LogRecord(
        name="uvicorn.access",
        level=logging.INFO,
        pathname="",
        lineno=0,
        msg='GET /api/drive/callback?code=sensitive-param&access_token=token-val HTTP/1.1 307',
        args=(),
        exc_info=None,
    )
    assert filter_obj.filter(record_msg) is True
    assert "sensitive-param" not in record_msg.msg
    assert "token-val" not in record_msg.msg
    assert "code=[REDACTED]" in record_msg.msg
    assert "access_token=[REDACTED]" in record_msg.msg


def test_redact_query_helpers_unit():
    """Unit tests for redact_query_text and redact_query_bytes."""
    # Query text alone
    assert redact_query_text("code=secret123&state=42") == "code=[REDACTED]&state=42"
    assert redact_query_text("state=42&CODE=secret123") == "state=42&CODE=[REDACTED]"
    assert redact_query_text("code=abc&client_secret=xyz") == "code=[REDACTED]&client_secret=[REDACTED]"
    assert redact_query_text("error=access_denied&state=1") == "error=access_denied&state=1"
    assert redact_query_text("") == ""

    # Query bytes
    assert redact_query_bytes(b"code=secret123&state=42") == b"code=[REDACTED]&state=42"
    assert redact_query_bytes(b"") == b""

