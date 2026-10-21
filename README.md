# YouTube Subtitle Manager

A React and TypeScript app for saving YouTube videos, retrieving English captions, organizing a subtitle library, and optionally uploading captions to Google Drive. The same Vinext application runs locally in the Cloudflare Workers emulator and on ChatGPT Sites.

## Technology

The repository root is the canonical release application. `app/`, `lib/`, `components/`, `build/`, `db/`, `drizzle/`, and the root npm lockfile ship together. Root CI installs, migrates, typechecks, tests, builds, and runs browser checks. `backend/` is the optional laptop FastAPI/yt-dlp companion for downloads that YouTube blocks from cloud IPs, with its own database and durable sync outbox. `frontend/` is its legacy local UI; neither is required to run the release app. `typescript-stack/` is an ignored, obsolete local snapshot: it is excluded from Git, TypeScript, tests, builds, and releases.

- React, TypeScript, Tailwind CSS, and the official Sites Vinext starter (`sites()` integration)
- TypeScript API routes on the Cloudflare Workers runtime
- Cloudflare D1 with Drizzle ORM and committed SQL migrations in `drizzle/`
- Zod request validation, Vitest unit tests, and Playwright browser tests
- Node.js, npm, Wrangler, and the committed `package-lock.json`

The Site uses the `DB` D1 binding declared in `.openai/hosting.json`. Captions are stored as text in D1, so R2 is currently unused. The local D1 database is persisted under `.wrangler/state`; local and hosted databases remain separate. Deploying does not copy local rows to the hosted database.

## Run on Windows

Use Node.js 22.13 or newer, Git, and npm. In PowerShell, from the repository root:

```powershell
npm ci
Copy-Item .dev.vars.example .dev.vars
npm run build
npm run test:scheduled
npm run db:migrate:local
npm run dev
```

Open `http://localhost:5173`. Sites' local development integration simulates ChatGPT sign-in. Google Drive and YouTube playlist account features need OAuth credentials; ordinary local development and subtitle retrieval do not.

To add Drive or playlist OAuth credentials, edit the ignored `.dev.vars` file. Register `http://localhost:5173/app/api/drive/callback` as an authorized redirect URI in your Google OAuth client. Generate a fresh encryption key in PowerShell with:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Set the result as `GOOGLE_TOKEN_ENCRYPTION_KEY` in `.dev.vars`, along with `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Never place secrets in source code or client-side variables.

## Apply local database migrations

Build once so Wrangler can read the generated Worker configuration, then apply the committed Drizzle SQL migrations to the persistent local D1 emulator:

```powershell
npm run build
npm run db:migrate:local
```

The schema in `db/schema.ts` and the ordered SQL files in `drizzle/` are shared by local and hosted deployments. `npm run db:generate` creates a migration after a schema change; review and commit the generated SQL and Drizzle metadata.

## Production preview

Build the Worker, apply local migrations, then run the built Worker through Wrangler/Miniflare:

```powershell
npm run build
npm run db:migrate:local
npm start
```

Wrangler prints the local preview URL. It uses the same D1 persistence directory as the local migration command. Stop the preview with `Ctrl+C`.

## Checks

Hosted work runs from the Worker's every-minute scheduled handler, independently of dashboard reads. D1 rows are the durable queue: caption text is checkpointed before Drive work, and playlist cleanup waits for saved captions. Per-user leases exclude overlapping invocations; a crashed invocation becomes recoverable after 15 minutes. External requests share a two-minute deadline per user, well below the lease. Retries preserve captions, backoff timestamps, and reserved Drive IDs. `npm run test:scheduled` invokes the built handler directly in Miniflare with a fresh database, avoiding Wrangler's static-asset scheduler proxy issue. To run local jobs against your development data, set `HOSTED_JOBS_TOKEN` and POST the protected endpoint; ordinary page loads never run jobs.

Deploy the generated cron configuration along with the Worker. If a hosting provider does not register cron triggers, configure an external scheduler to POST `/api/internal/jobs/run` every minute with `Authorization: Bearer <HOSTED_JOBS_TOKEN>`. Set that secret in the runtime and scheduler; never expose it to browser code.

```powershell
npm run typecheck
npm test
npm run build
```

Browser tests use Playwright against the built Worker in Miniflare with a fresh D1 database. The test host supplies deterministic YouTube and Drive responses at the outbound network boundary; no production routes are mocked. Tests cover import, saved SRT, Drive completion, edits after reload, deletion, token rotation, user isolation, and a Worker restart after remote upload success but before database confirmation. They assert that recovery reuses the same file without another caption request or upload. Gateway identity headers are supplied only to the local test host.

The release gate also calls the actual Python companion HTTP adapter against that Worker. Install Python 3.11+ and `pip install -r backend/requirements.txt` (or use `backend/.venv`) before running the full browser suite:

```powershell
npx playwright install chromium
npm run build
npm run db:migrate:local
npm run test:e2e
```

Tests use local D1 state and fixtures; they do not upload local data to the hosted Site.

The companion schema has its own committed Alembic chain. From `backend/`, run `python -m alembic upgrade head` before starting it. CI checks these migrations against a fresh SQLite database separately from the companion tests.

The pairing contract is documented in [docs/sync-contract.md](docs/sync-contract.md).

## Deploy through Sites

The Sites plugin workflow builds and packages the pushed source for the existing Site. Keep its current audience and project ID. Configure production OAuth secrets through Sites runtime environment settings. D1 and R2 bindings are declared in `.openai/hosting.json`; do not copy local database files into deployment artifacts.

Sites hosting, storage, and usage depend on the current ChatGPT plan and limits. The development tools and application dependencies are free and open source; hosting is not promised to be unlimited or free. See [ChatGPT Sites documentation](https://learn.chatgpt.com/docs/sites) for current availability and limits.
