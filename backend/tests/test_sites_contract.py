"""Exercise the real Python adapter against the built Worker during release E2E."""
import os
from datetime import datetime, timezone

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.user import User
from app.models.video import Video
from app.models.sync_operation import SyncOperation
from app.services import sites_sync_service as sync


@pytest.mark.skipif(not os.getenv("SITES_CONTRACT_URL"), reason="Runs inside release browser gate")
def test_python_adapter_against_worker(tmp_path, monkeypatch):
    base = os.environ["SITES_CONTRACT_URL"]
    monkeypatch.setattr(sync.settings, "SITES_SYNC_URL", base)
    monkeypatch.setattr(sync.settings, "SITES_SERVICE_TOKEN", "")
    site_headers = {"oai-authenticated-user-id": "python-contract", "oai-authenticated-user-email": "python@example.test"}
    token = httpx.post(base + "/api/sync/pair", headers=site_headers).json()["token"]
    encrypted = sync.encrypt_token(token)
    assert sync.get_pairing_identity(token)["user_id"] == "python-contract"
    assert sync.get_prompt_link(encrypted) is None
    sync.set_prompt_link(encrypted, "https://chatgpt.com/c/python")
    assert sync.get_prompt_link(encrypted) == "https://chatgpt.com/c/python"
    sync.set_prompt_link(encrypted, None)
    assert sync.get_prompt_link(encrypted) is None
    engine = create_engine(f"sqlite:///{tmp_path / 'contract.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    with factory() as db:
        user = User(email="python@example.test", hashed_password="unused", sites_sync_token=encrypted)
        db.add(user)
        db.flush()
        video = Video(user_id=user.id, video_id="python00001", youtube_url="https://youtu.be/python00001", title="Python upload", status="COMPLETED", subtitle_type="MANUAL", created_at=datetime(2026, 1, 1, tzinfo=timezone.utc), updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
        db.add(video)
        db.commit()
        headers = {"Authorization": f"Bearer {token}"}
        response = httpx.post(base + "/api/sync/videos", headers=headers, json=sync._payload(video))
        response.raise_for_status()
        video.sites_synced = 1
        db.query(SyncOperation).delete()
        db.commit()
        edited = httpx.patch(base + f"/api/videos/{response.json()['id']}", headers=site_headers, json={"tags": ["remote"], "watch_status": "DONE"})
        edited.raise_for_status()
        assert sync.reconcile_library(db, user)["pulled"] == 1
        db.refresh(video)
        assert video.tags == ["remote"] and video.watch_status == "DONE"
        assert db.query(SyncOperation).count() == 0
        # A rotated token resumes the same library, while the old token is rejected.
        replacement = httpx.post(base + "/api/sync/pair", headers=site_headers).json()["token"]
        assert sync.get_pairing_identity(token) is None
        user.sites_sync_token = sync.encrypt_token(replacement)
        db.commit()
        assert sync.reconcile_library(db, user) == {"pulled": 0, "queued": 0}
        httpx.delete(base + "/api/sync/videos/python00001", headers={"Authorization": f"Bearer {replacement}"}).raise_for_status()
        sync.reconcile_library(db, user)
        assert db.query(Video).count() == 0
    engine.dispose()
