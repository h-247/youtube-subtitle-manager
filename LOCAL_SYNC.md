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
