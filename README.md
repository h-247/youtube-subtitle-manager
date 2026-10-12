# YouTube Subtitle Manager on ChatGPT Sites

This version runs as a Vinext application on the Sites Worker runtime. It replaces FastAPI and PostgreSQL with same-origin Worker API routes and Sites D1. Library records are scoped to the authenticated ChatGPT user ID. The Site is private by default.

## Features

- ChatGPT sign-in and sign-out
- Private video library with search, subtitle/watch-status filters, tags, and pagination
- Video and Short ingestion; playlist ingestion adds up to 20 videos from the public playlist page
- English caption selection, preferring manual captions and falling back to auto captions
- SRT downloads, watch-status edits, ChatGPT links, channel tags, and record deletion
- Unlimited retries with capped exponential delay while the library is open; an in-flight record resumes when the dashboard is opened again

## Sites storage and API

Sites provisions the `DB` D1 binding from `.openai/hosting.json`. The Drizzle schema and generated SQL migration are in `db/schema.ts` and `drizzle/`. API routes live under `app/api/`.

YouTube captions are retrieved through YouTube's public player and timed-text HTTP endpoints. Workers do not run `yt-dlp` or a persistent Python worker; caption retries are driven by dashboard requests and pause while no dashboard is open.

Google Drive uses the OAuth authorization-code flow and the least-privilege `drive.file` scope. Set these production Site secrets before users connect: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_TOKEN_ENCRYPTION_KEY` (a base64url-encoded random 32-byte key). Register `https://youtube-subtitle-manager.h-247.chatgpt.site/api/drive/callback` as an authorized redirect URI in the Google OAuth client and enable the Google Drive API. Per-user access and refresh tokens are encrypted with AES-GCM before they are stored in D1. Completed SRT files are uploaded into a `YouTube Subtitles` folder; connected users' completed files, including existing files, are synced one at a time as the dashboard refreshes, with uncapped retries and exponential backoff while the dashboard is active. Direct SRT downloads remain available.

## Local development

Requirements: Node.js 22.13 or later.

```powershell
npm run install:ci
npm run db:generate
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_furry_omega_sentinel.sql
npm run dev
```

The portable local preview supports the seeded test identity `seedy@sites.test` via `/signin-with-chatgpt?return_to=/dashboard`. That mock sign-in is not included in the hosted Site.
