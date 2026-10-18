# FastAPI subtitle backend for ChatGPT Sites

The Sites frontend keeps user libraries and Google Drive connections in D1. When
`SUBTITLE_BACKEND_URL` and `SUBTITLE_BACKEND_TOKEN` are configured as Site runtime
secrets, subtitle retries use the authenticated `POST /api/sites/subtitle` route
in this FastAPI service. The route runs yt-dlp with a backend-only cookie secret
and returns English subtitle text to the Site Worker.

## Hosting

This backend is designed to run as a Docker web service. Choose a provider that
supports Dockerfile deployments, a configurable HTTP port (`PORT`), HTTPS, and
runtime secrets. The repository does not contain provider-specific deployment
configuration yet.

Set these secrets on the backend service:

- `SUBTITLE_BACKEND_TOKEN`: generate a random secret with at least 32 bytes.
- `YTDLP_COOKIES_JSON`: a fresh YouTube cookie export in JSON-array format.

Do not reuse cookie exports pasted into chat or committed to a repository.
Configure both values as runtime secrets. Keep the cookie only on the backend;
never add it to the Site runtime. The service exposes `/health` for health checks
and uses temporary storage. Site D1 remains the source of truth for user and
video records.

After the backend is live, configure these Site runtime secrets and deploy the
Site version containing the integration:

- `SUBTITLE_BACKEND_URL`: the HTTPS service origin.
- `SUBTITLE_BACKEND_TOKEN`: the same random token configured on the backend.

The backend does not need its own database for this Sites integration: video
metadata, statuses, and Google Drive state remain in D1.

## Local laptop downloads with Sites library sync

When the regular local FastAPI app is paired with Sites, it downloads subtitles
using the laptop's yt-dlp and pushes video records and subtitle text outbound to
the paired user's Sites D1 library. No inbound tunnel is needed for this mode.
Sign in to Sites, choose **Pair Local App**, copy the one-time code, then choose
**ChatGPT Site** on the local app's sign-in page and paste the code. The Site
verifies the code and returns its stable user ID and email to the local API. The
local account is created or linked by Site user ID, and the code is encrypted in
the local database for outbound library sync. Sites stores only a SHA-256 hash
of the code. Rotating the code revokes any previous pairing; sign in locally
again with a newly generated code. Existing local email/password accounts remain
available under **Email & Password**. Run Alembic migrations before starting a
PostgreSQL-backed local API; SQLite development databases add the identity
column at startup.


## Durable local jobs

Run one backend process (`uvicorn app.main:app`, without `--workers`) per local
DB. `PROCESSING` video rows form the durable download queue. On startup the
scheduler scans them automatically; `DOWNLOAD_CONCURRENCY` defaults to 2.
Each retry releases its slot so a failing video cannot starve the library.
Retry counts survive restarts, with capped backoff and no attempt limit.

`sync_operations` is an ordered transactional outbox. Video inserts, updates,
and deletion tombstones commit together with library changes. Delivery resumes
automatically, retries indefinitely and removes operations only after an HTTP
success. Disconnection pauses pending work; reconnecting the same Sites account
resumes it. Delivery is at least once (Sites upserts/deletes must be idempotent).
The local navbar shows pending work and retry errors from `/api/sites-sync/status`.

SQLite startup creates the outbox automatically. For managed database installs,
run `alembic upgrade head` before starting the backend. CI runs backend pytest,
frontend typecheck and production build on every push and pull request. Integration
tests use temporary SQLite databases and simulated Sites responses, not live accounts.
