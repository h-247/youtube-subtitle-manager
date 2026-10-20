# Laptop synchronization contract

The laptop performs subtitle downloads. This Site keeps the paired account's
library available when the laptop is offline.

- Pairing codes are hashed and resolved on every request. Revoked codes return
  401 without changing the library.
- POST is a user-scoped upsert. Older updated_at values do not replace newer
  Site records. Existing Drive links survive absent incoming links.
- DELETE is user-scoped and idempotent, including repeated deletes.
- Successful mutations acknowledge with `{ "synced": true }`.
- The laptop saves operations in a transactional DB outbox, retries indefinitely
  with capped backoff, and retains deletion tombstones until acknowledgement.
  Each video's operations retain order.
- Reconnect the same Site account after rotating a code. Pending operations
  resume with the refreshed code. The local navbar reports pending work/errors.

Run one local backend process per DB. PROCESSING downloads resume after restart,
with DOWNLOAD_CONCURRENCY=2 by default. Failed attempts release their slot.
Integration tests and CI live in the companion GitHub repository.


Sites retains deletion tombstones per account and video. A replay from a record
created before deletion acknowledges with `synced: true, deleted: true` and does
not recreate the video. A deliberate new ingestion with a later creation date is
allowed. Deletion and its tombstone commit together in a D1 batch. Laptop updates
also use a tombstone guard in their INSERT statement to cover concurrent deletion.

Sites commits subtitle text before the independent Drive upload queue. Upload
errors retain the text, set `error_category=DRIVE_UPLOAD`, and retry with capped
backoff. Download failures use `DOWNLOAD`. Edit Video Record exposes Pause automatic
retries for both download and upload; pause state is included in library sync.
Pending Drive uploads rotate by last attempt so one outage does not starve others.

Run `node --test tests/sync-recovery.mjs` for D1-compatible SQLite coverage of
idempotent delivery, deletion replay after re-pairing, and independent Drive retry
with saved text and pause/resume.


## Per-video tags

Tags are independent video arrays (`tags` on the API, `tags_json` in storage).
Channel-wide tag assignment is retired. Synchronization replaces only the addressed
video's tags and never updates siblings or the historical channel tag table.
Legacy per-video strings remain readable until the record is next edited.
Single-video import takes selected tags; playlist import adds the exact playlist
name to every entry, preserving existing tags and completed downloads on duplicates.
