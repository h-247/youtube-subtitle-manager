import json
from unittest.mock import Mock

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.user import User
from app.models.video import Video
from app.models.sync_operation import SyncOperation
from app.services import durable_jobs as jobs
from app.services import ingestion_service as ingestion
from app.services.sites_sync_service import encrypt_token


@pytest.fixture
def persistent_db(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'jobs.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    monkeypatch.setattr(jobs, "SessionLocal", factory)
    monkeypatch.setattr(ingestion, "get_db_session", factory)
    with factory() as db:
        user = User(email="paired@example.com", hashed_password="unused", sites_sync_token=encrypt_token("a" * 40))
        db.add(user)
        db.flush()
        db.add(Video(user_id=user.id, video_id="abcdefghijk", youtube_url="https://youtu.be/abcdefghijk", title="Original", status="PROCESSING", retry_count=7))
        db.commit()
    yield factory
    engine.dispose()


def test_outbox_survives_network_failure_and_restart(persistent_db, monkeypatch):
    monkeypatch.setattr(jobs.httpx, "post", Mock(side_effect=httpx.ConnectError("offline")))
    jobs.deliver_pending()
    with persistent_db() as db:
        op = db.query(SyncOperation).one()
        assert op.attempts == 1 and op.error
        op.next_attempt = 0
        db.commit()
    # New sessions read the same durable operation after a failed delivery.
    post = Mock(return_value=httpx.Response(200, json={"synced": True}, request=httpx.Request("POST", "https://example.com")))
    monkeypatch.setattr(jobs.httpx, "post", post)
    jobs.deliver_pending()
    with persistent_db() as db:
        assert db.query(SyncOperation).count() == 0
    assert post.call_args.kwargs["json"]["title"] == "Original"


def test_delete_tombstone_atomic_and_ordered(persistent_db, monkeypatch):
    with persistent_db() as db:
        video = db.query(Video).one()
        db.delete(video)
        db.flush()
        assert db.query(SyncOperation).count() == 1
        db.rollback()
        assert db.query(Video).count() == 1
        assert db.query(SyncOperation).count() == 1
        db.delete(db.query(Video).one())
        db.commit()
    delete = Mock(return_value=httpx.Response(200, json={"synced": True}, request=httpx.Request("DELETE", "https://example.com")))
    monkeypatch.setattr(jobs.httpx, "delete", delete)
    jobs.deliver_pending()
    delete.assert_called_once()
    with persistent_db() as db:
        assert db.query(Video).count() == db.query(SyncOperation).count() == 0


def test_restart_recovers_processing_and_limits_concurrency(persistent_db, monkeypatch):
    monkeypatch.setattr(jobs.settings, "DOWNLOAD_CONCURRENCY", 1)
    with persistent_db() as db:
        db.add(Video(user_id=1, video_id="second", youtube_url="https://youtu.be/second", title="Second", status="PROCESSING"))
        db.commit()
    thread = Mock()
    monkeypatch.setattr(ingestion.threading, "Thread", thread)
    ingestion._active_video_ids.clear()
    try:
        ingestion.dispatch_pending()
        ingestion.dispatch_pending()
        assert thread.call_count == 1
        assert len(ingestion._active_video_ids) == 1
        with persistent_db() as db:
            assert db.query(Video).filter(Video.retry_count == 7).count() == 1
    finally:
        ingestion._active_video_ids.clear()


def test_recovered_worker_retains_retry_count(persistent_db, monkeypatch):
    download = Mock(return_value={"status": "COMPLETED", "file_path": None})
    monkeypatch.setattr(ingestion, "download_subtitles", download)
    ingestion._process_video_worker(1, 1, 0)
    with persistent_db() as db:
        video = db.get(Video, 1)
        assert video.status == "COMPLETED" and video.retry_count == 7


def test_pairing_account_mismatch_and_revoked_login(client, user_a, user_a_headers, monkeypatch):
    monkeypatch.setattr("app.api.sites_sync.sync_user_async", Mock())
    monkeypatch.setattr("app.api.auth.sync_user_async", Mock())
    monkeypatch.setattr("app.api.sites_sync.get_pairing_identity", lambda token: {"user_id": "site-a", "email": user_a.email})
    response = client.post("/api/sites-sync/connect", headers=user_a_headers, json={"token": "a" * 40})
    assert response.status_code == 200
    monkeypatch.setattr("app.api.sites_sync.get_pairing_identity", lambda token: {"user_id": "site-b", "email": "other@example.com"})
    assert client.post("/api/sites-sync/connect", headers=user_a_headers, json={"token": "b" * 40}).status_code == 409
    monkeypatch.setattr("app.api.auth.get_pairing_identity", lambda token: {"user_id": "site-a", "email": user_a.email})
    response = client.post("/api/auth/sites-login", json={"pairing_code": "a" * 40})
    assert response.status_code == 200 and response.json()["user"]["id"] == user_a.id
    monkeypatch.setattr("app.api.auth.get_pairing_identity", lambda token: None)
    assert client.post("/api/auth/sites-login", json={"pairing_code": "a" * 40}).status_code == 401


def test_revoked_sync_retains_operation(persistent_db, monkeypatch):
    monkeypatch.setattr(jobs.httpx, "post", Mock(return_value=httpx.Response(401, request=httpx.Request("POST", "https://example.com"))))
    jobs.deliver_pending()
    with persistent_db() as db:
        op = db.query(SyncOperation).one()
        assert op.attempts == 1 and "pairing" in op.error


def test_retry_backoff_releases_slot_for_other_videos(persistent_db, monkeypatch):
    monkeypatch.setattr(ingestion, "download_subtitles", Mock(return_value={"status": "FAILED", "error_message": "offline"}))
    ingestion._process_video_worker(1, 1, 0)
    with persistent_db() as db:
        first = db.get(Video, 1)
        assert first.status == "PROCESSING" and first.retry_count == 8
        db.add(Video(user_id=1, video_id="next", youtube_url="https://youtu.be/next", title="Next", status="PROCESSING"))
        db.commit()
    monkeypatch.setattr(jobs.settings, "DOWNLOAD_CONCURRENCY", 1)
    thread = Mock()
    monkeypatch.setattr(ingestion.threading, "Thread", thread)
    ingestion._active_video_ids.clear()
    try:
        ingestion.dispatch_pending()
        assert thread.call_args.kwargs["args"][0] == 2
    finally:
        ingestion._active_video_ids.clear()


def test_success_without_acknowledgement_retains_operation(persistent_db, monkeypatch):
    monkeypatch.setattr(jobs.httpx, "post", Mock(return_value=httpx.Response(200, json={}, request=httpx.Request("POST", "https://example.com"))))
    jobs.deliver_pending()
    with persistent_db() as db:
        op = db.query(SyncOperation).one()
        assert op.attempts == 1 and op.error


def test_reconcile_pulls_newer_site_tags_without_echo(persistent_db, monkeypatch):
    from app.services.sites_sync_service import reconcile_library
    from app.models.channel_tag import ChannelTag
    payload = {"items": [{"video_id": "abcdefghijk", "updated_at": "2030-01-01T00:00:00Z", "watch_status": "DOING",
                          "channel_tags": "en", "chatgpt_link": "https://chatgpt.com/c/example"}],
               "channel_tags": [{"channel_title": "Channel", "tag": "en"}], "next_offset": None}
    monkeypatch.setattr(jobs.httpx, "get", Mock(return_value=httpx.Response(200, json=payload, request=httpx.Request("GET", "https://example.com"))))
    with persistent_db() as db:
        db.query(SyncOperation).delete()
        video = db.get(Video, 1)
        video.channel_title = "Channel"
        db.commit()
        db.query(SyncOperation).delete()
        db.commit()
        result = reconcile_library(db, db.get(User, 1))
        assert result == {"pulled": 1, "queued": 0}
        assert video.watch_status == "DOING" and video.channel_tags == "en"
        assert video.tags == ["en"]
        assert db.query(ChannelTag).count() == 0
        assert db.query(SyncOperation).count() == 0
        assert reconcile_library(db, db.get(User, 1)) == {"pulled": 0, "queued": 0}


def test_reconcile_preserves_pending_local_edits(persistent_db, monkeypatch):
    from app.services.sites_sync_service import reconcile_library
    payload = {"items": [{"video_id": "abcdefghijk", "updated_at": "2030-01-01T00:00:00Z", "watch_status": "DONE"}], "channel_tags": [], "next_offset": None}
    monkeypatch.setattr(jobs.httpx, "get", Mock(return_value=httpx.Response(200, json=payload, request=httpx.Request("GET", "https://example.com"))))
    with persistent_db() as db:
        assert reconcile_library(db, db.get(User, 1)) == {"pulled": 0, "queued": 0}
        assert db.get(Video, 1).watch_status == "TO_DO"
        assert db.query(SyncOperation).count() == 1


def test_reconcile_requeues_missing_site_record_once(persistent_db, monkeypatch):
    from app.services.sites_sync_service import reconcile_library
    monkeypatch.setattr(jobs.httpx, "get", Mock(return_value=httpx.Response(200, json={"items": [], "channel_tags": [], "next_offset": None}, request=httpx.Request("GET", "https://example.com"))))
    with persistent_db() as db:
        db.query(SyncOperation).delete()
        db.commit()
        assert reconcile_library(db, db.get(User, 1)) == {"pulled": 0, "queued": 1}
        assert reconcile_library(db, db.get(User, 1)) == {"pulled": 0, "queued": 0}
        assert db.query(SyncOperation).count() == 1


def test_explicit_sync_does_not_duplicate_event(persistent_db):
    from app.services.sites_sync_service import sync_video
    with persistent_db() as db:
        video = db.get(Video, 1)
        video.title = "Edited offline"
        sync_video(db, video)
        sync_video(db, video)
        assert db.query(SyncOperation).count() == 1
        assert json.loads(db.query(SyncOperation).one().payload)["title"] == "Edited offline"


def test_drive_failure_retries_saved_text_after_restart(persistent_db, monkeypatch, tmp_path):
    path = tmp_path / "subtitle.txt"
    path.write_text("Saved subtitle", encoding="utf-8")
    download = Mock(return_value={"status": "COMPLETED", "file_path": str(path), "subtitle_type": "MANUAL"})
    monkeypatch.setattr(ingestion, "download_subtitles", download)
    upload = Mock(side_effect=RuntimeError("offline"))
    monkeypatch.setattr(ingestion.drive_service, "upload_subtitle", upload)
    with persistent_db() as db:
        db.get(User, 1).drive_credentials = '{}'
        db.commit()
    ingestion._process_video_worker(1, 1, 0)
    with persistent_db() as db:
        video = db.get(Video, 1)
        assert video.download_complete and video.subtitle_text == "Saved subtitle"
        assert video.error_category == "DRIVE_UPLOAD"
    ingestion._process_video_worker(1, 1, 0)
    upload.side_effect = None
    upload.return_value = {"drive_file_id": "file", "drive_file_url": "https://drive.google.com/file"}
    ingestion._process_video_worker(1, 1, 0)
    assert download.call_count == 1
    assert upload.call_count == 3
    with persistent_db() as db:
        assert db.get(Video, 1).status == "COMPLETED"


def test_cloud_deletion_wins_offline_edit_and_repairing(persistent_db, monkeypatch):
    from app.services import sites_sync_service as sync
    monkeypatch.setattr(sync, "SessionLocal", persistent_db)
    with persistent_db() as db:
        video = db.get(Video, 1)
        video.sites_synced = 1
        video.title = "Offline edit"
        db.commit()
    sync.sync_user_async(1)
    monkeypatch.setattr(jobs.httpx, "get", Mock(return_value=httpx.Response(200, json={"items": [], "channel_tags": [], "next_offset": None}, request=httpx.Request("GET", "https://example.com"))))
    with persistent_db() as db:
        sync.reconcile_library(db, db.get(User, 1))
        assert db.query(Video).count() == db.query(SyncOperation).count() == 0


def test_pause_survives_restart(persistent_db, monkeypatch):
    with persistent_db() as db:
        db.get(Video, 1).processing_paused = 1
        db.commit()
    download = Mock()
    monkeypatch.setattr(ingestion, "download_subtitles", download)
    ingestion._process_video_worker(1, 1, 0)
    download.assert_not_called()
    with persistent_db() as db:
        db.get(Video, 1).processing_paused = 0
        db.commit()
    download.return_value = {"status": "COMPLETED", "file_path": None}
    ingestion._process_video_worker(1, 1, 0)
    download.assert_called_once()
    with persistent_db() as db:
        assert db.get(Video, 1).status == "COMPLETED"


def test_disconnected_delete_and_repair_preserve_tombstone(persistent_db, monkeypatch):
    from app.services import sites_sync_service as sync
    monkeypatch.setattr(sync, "SessionLocal", persistent_db)
    with persistent_db() as db:
        user = db.get(User, 1)
        user.sites_user_id = "same-account"
        user.sites_sync_token = None
        db.commit()
        db.delete(db.get(Video, 1))
        db.commit()
    jobs.deliver_pending()
    with persistent_db() as db:
        assert db.query(SyncOperation).one().operation == "delete"
        db.get(User, 1).sites_sync_token = encrypt_token("fresh" * 10)
        db.commit()
    sync.sync_user_async(1)
    delete = Mock(return_value=httpx.Response(200, json={"synced": True}, request=httpx.Request("DELETE", "https://example.com")))
    monkeypatch.setattr(jobs.httpx, "delete", delete)
    jobs.deliver_pending()
    delete.assert_called_once()
    with persistent_db() as db:
        assert db.query(SyncOperation).count() == 0


def test_acknowledgement_does_not_remove_inflight_edit(persistent_db, monkeypatch):
    def acknowledge(*args, **kwargs):
        with persistent_db() as db:
            db.get(Video, 1).title = "Edited during delivery"
            db.commit()
        return httpx.Response(200, json={"synced": True}, request=httpx.Request("POST", "https://example.com"))
    monkeypatch.setattr(jobs.httpx, "post", acknowledge)
    jobs.deliver_pending()
    with persistent_db() as db:
        assert json.loads(db.query(SyncOperation).one().payload)["title"] == "Edited during delivery"



def test_reconcile_video_tags_are_independent_and_clearable(persistent_db, monkeypatch):
    from app.services.sites_sync_service import reconcile_library
    with persistent_db() as db:
        db.get(Video, 1).channel_title = "Shared"
        db.get(Video, 1).tags = ["old"]
        db.add(Video(user_id=1, video_id="secondvideo", youtube_url="https://youtu.be/secondvideo", title="Second", channel_title="Shared", tags_json='["other"]'))
        db.commit(); db.query(SyncOperation).delete(); db.commit()
    payload = {"items": [
        {"video_id": "abcdefghijk", "channel_title": "Shared", "updated_at": "2030-01-01T00:00:00Z", "tags": ["My Playlist, English"]},
        {"video_id": "secondvideo", "channel_title": "Shared", "updated_at": "2030-01-01T00:00:00Z", "tags": ["other"]},
    ], "channel_tags": [], "next_offset": None}
    monkeypatch.setattr(jobs.httpx, "get", Mock(side_effect=lambda *a, **k: httpx.Response(200, json=payload, request=httpx.Request("GET", "https://example.com"))))
    with persistent_db() as db:
        reconcile_library(db, db.get(User, 1))
        assert db.get(Video, 1).tags == ["My Playlist, English"]
        assert db.query(Video).filter_by(video_id="secondvideo").one().tags == ["other"]
        payload["items"][0].update(tags=[], updated_at="2031-01-01T00:00:00Z")
        reconcile_library(db, db.get(User, 1))
        assert db.get(Video, 1).tags == []
        assert db.query(Video).filter_by(video_id="secondvideo").one().tags == ["other"]
        assert db.query(SyncOperation).count() == 0


def test_local_video_tag_edit_enqueues_only_that_video(client, user_a, user_a_headers, db_session, monkeypatch):
    monkeypatch.setattr("app.api.videos.sync_video_async", Mock())
    user_a.sites_sync_token = encrypt_token("a" * 40)
    for vid in ["firstvideo1", "secondvid01"]:
        db_session.add(Video(user_id=user_a.id, video_id=vid, youtube_url="https://youtu.be/"+vid, title=vid, channel_title="Shared", channel_tags="old"))
    db_session.commit(); db_session.query(SyncOperation).delete(); db_session.commit()
    first = db_session.query(Video).filter_by(video_id="firstvideo1").one()
    response = client.patch(f"/api/videos/{first.id}", headers=user_a_headers, json={"tags": ["My Playlist, English"]})
    assert response.status_code == 200
    assert response.json()["tags"] == ["My Playlist, English"]
    assert db_session.query(SyncOperation).count() == 1
    assert json.loads(db_session.query(SyncOperation).one().payload)["tags"] == ["My Playlist, English"]
    assert db_session.query(Video).filter_by(video_id="secondvid01").one().tags == ["old"]
    assert client.post("/api/videos/channel-tags", headers=user_a_headers, json={"channel_title": "Shared", "tags": "en"}).status_code == 410
    assert client.patch(f"/api/videos/{first.id}", headers=user_a_headers, json={"tags": []}).json()["tags"] == []
