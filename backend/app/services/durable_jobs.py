"""Single backend process dispatcher. DB records survive process termination.

Run one API worker per local database. Network delivery is at least once; Sites
upserts and deletes are idempotent. Each video's operations retain commit order.
"""
import json
import logging
import threading
import time

import httpx
from sqlalchemy import event, inspect, select
from sqlalchemy.orm import Session, object_session
from app.database import SessionLocal
from app.models.user import User
from app.models.video import Video
from app.models.sync_operation import SyncOperation
from app.services.sites_sync_service import _payload, _site_headers, decrypt_token
from app.config import settings

logger = logging.getLogger(__name__)
_delivery_lock = threading.Lock()


def values(video, operation="upsert"):
    return dict(user_id=video.user_id, video_id=video.video_id, operation=operation,
                payload=json.dumps(_payload(video), default=str), attempts=0, next_attempt=0)


def enqueue_sync(db, video):
    db.flush()
    if db.query(SyncOperation).filter_by(user_id=video.user_id, video_id=video.video_id).first():
        return
    user = db.get(User, video.user_id)
    if user and (user.sites_sync_token or user.sites_user_id):
        db.add(SyncOperation(**values(video)))


@event.listens_for(Video, "after_insert")
@event.listens_for(Video, "after_update")
def record_change(mapper, connection, video):
    session = object_session(video)
    if session and session.info.get("sites_pull"):
        return
    if not any(attr.history.has_changes() for attr in inspect(video).attrs if attr.key != "sites_synced"):
        return
    token = connection.execute(select(User.id).where(User.id == video.user_id, (User.sites_sync_token.isnot(None) | User.sites_user_id.isnot(None)))).scalar()
    if token:
        connection.execute(SyncOperation.__table__.delete().where(SyncOperation.user_id == video.user_id, SyncOperation.video_id == video.video_id))
        connection.execute(SyncOperation.__table__.insert().values(**values(video)))


@event.listens_for(Video, "after_delete")
def record_delete(mapper, connection, video):
    if object_session(video).info.get("sites_pull"):
        return
    token = connection.execute(select(User.id).where(User.id == video.user_id, (User.sites_sync_token.isnot(None) | User.sites_user_id.isnot(None)))).scalar()
    if token:
        connection.execute(SyncOperation.__table__.delete().where(SyncOperation.user_id == video.user_id, SyncOperation.video_id == video.video_id))
        connection.execute(SyncOperation.__table__.insert().values(**values(video, "delete")))


def deliver_pending():
    if not _delivery_lock.acquire(blocking=False):
        return
    try:
        with SessionLocal() as db:
            # Check cloud deletions before sending offline edits to acknowledged rows.
            from app.services.sites_sync_service import _reconcile_library
            guarded_users = {v.user_id for v in db.query(Video).filter(Video.sites_synced == 1).all()}
            unavailable = set()
            for user_id in guarded_users:
                try:
                    _reconcile_library(db, db.get(User, user_id))
                except Exception:
                    db.rollback()
                    unavailable.add(user_id)
            operations = db.query(SyncOperation).order_by(SyncOperation.id).all()
            blocked = set()
            for op in operations:
                key = (op.user_id, op.video_id)
                if key in blocked or (op.user_id in unavailable and op.operation != "delete"):
                    continue
                blocked.add(key)
                user = db.get(User, op.user_id)
                if not user or not user.sites_sync_token or op.next_attempt > time.time():
                    continue
                sent_id, sent_payload, sent_operation = op.id, op.payload, op.operation
                try:
                    headers = _site_headers(decrypt_token(user.sites_sync_token))
                    url = settings.SITES_SYNC_URL.rstrip('/') + '/api/sync/videos'
                    if op.operation == "delete":
                        response = httpx.delete(url + '/' + op.video_id, headers=headers, timeout=10)
                    else:
                        response = httpx.post(url, headers=headers, json=json.loads(op.payload), timeout=45)
                    response.raise_for_status()
                    result = response.json()
                    if result.get("synced") is not True:
                        raise ValueError("Sites did not acknowledge the operation")
                    if op.operation != "delete":
                        connection = db.connection()
                        connection.execute(Video.__table__.update().where(Video.user_id == op.user_id, Video.video_id == op.video_id).values(sites_synced=1, updated_at=Video.updated_at))
                        uploads = result.get("drive_uploads", [result.get("drive_upload")])
                        for upload in uploads or []:
                            if not isinstance(upload, dict):
                                continue
                            video = db.query(Video).filter(Video.user_id == op.user_id, Video.video_id == upload.get("video_id")).first()
                            if video and upload.get("drive_file_id") and upload.get("drive_file_url"):
                                video.drive_file_id = upload["drive_file_id"]
                                video.drive_file_url = upload["drive_file_url"]
                    db.query(SyncOperation).filter(
                        SyncOperation.id == sent_id, SyncOperation.payload == sent_payload,
                        SyncOperation.operation == sent_operation,
                    ).delete(synchronize_session=False)
                    db.commit()
                except Exception as exc:
                    db.rollback()
                    op = db.get(SyncOperation, sent_id)
                    if op and op.payload == sent_payload and op.operation == sent_operation:
                        op.attempts += 1
                        op.next_attempt = time.time() + min(60, 2 ** min(op.attempts, 6))
                        # Never persist tokens, URLs, or response bodies from exceptions.
                        op.error = (
                            "Sites pairing was rejected. Reconnect with a fresh pairing code; pending changes are retained."
                            if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code in (401, 403)
                            else "Sites sync failed. Check network and pairing code; automatic retry continues."
                        )
                        db.commit()
    finally:
        _delivery_lock.release()


class JobRunner:
    def __init__(self):
        self.stop_event = threading.Event()
        self.threads = []

    def start(self):
        from app.services.ingestion_service import dispatch_pending
        from app.services.sites_sync_service import reconcile_libraries
        from app.services.youtube_playlist_service import process_playlist_removals
        for action, interval in ((dispatch_pending, 1), (deliver_pending, 1), (reconcile_libraries, 15), (process_playlist_removals, 10)):
            def run(action=action, interval=interval):
                while not self.stop_event.is_set():
                    try:
                        action()
                    except Exception:
                        logger.exception("Background dispatcher failed; retrying")
                    self.stop_event.wait(interval)
            thread = threading.Thread(target=run, daemon=True)
            self.threads.append(thread)
            thread.start()

    def stop(self):
        self.stop_event.set()
        for thread in self.threads:
            thread.join(timeout=1)
