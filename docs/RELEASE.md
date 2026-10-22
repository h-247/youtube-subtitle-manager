# Site release verification

The `Release and companion checks` workflow builds and tests one GitHub commit, then uploads `site-release-<commit SHA>` from `dist/`. Its `release-manifest.json` records the commit and Git tree; the Worker bundle reports that same commit at `/api/health`.

Publish the matching artifact or package the exact same clean commit. After the Site is live, run **Actions → Verify deployed Site release** with the deployed URL and the SHA from the artifact name. Configure the repository secrets `SITE_SMOKE_USER_ID` and `SITE_SMOKE_USER_EMAIL` with a dedicated test identity. The check waits for that exact Worker revision and a successful scheduler heartbeat, confirms the library rejects anonymous access, then confirms an authenticated library response.

The verifier is read-only. Its authenticated request uses the configured dedicated test identity headers and does not create or edit library records.
