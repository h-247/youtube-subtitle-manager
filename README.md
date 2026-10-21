# YouTube Subtitle Manager

A React and TypeScript app for saving YouTube videos, retrieving English captions, organizing a subtitle library, and optionally uploading captions to Google Drive. The same Vinext application runs locally in the Cloudflare Workers emulator and on ChatGPT Sites.

## Technology

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

```powershell
npm run typecheck
npm test
npm run build
```

Browser tests use Playwright and the local Sites auth simulation:

```powershell
npx playwright install chromium
npm run test:e2e
```

Tests use local D1 state and fixtures; they do not upload local data to the hosted Site.

## Deploy through Sites

The Sites plugin workflow builds and packages the pushed source for the existing Site. Keep its current audience and project ID. Configure production OAuth secrets through Sites runtime environment settings. D1 and R2 bindings are declared in `.openai/hosting.json`; do not copy local database files into deployment artifacts.

Sites hosting, storage, and usage depend on the current ChatGPT plan and limits. The development tools and application dependencies are free and open source; hosting is not promised to be unlimited or free. See [ChatGPT Sites documentation](https://learn.chatgpt.com/docs/sites) for current availability and limits.
