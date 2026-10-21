# Laptop-to-Sites contract

Every `/api/sync/*` endpoint except `/pair` authenticates a hashed pairing token in `Authorization: Bearer <token>`. An invalid or revoked token returns 401. The token determines the owner; payloads cannot select another owner. `/pair` uses the Sites gateway identity. Re-pairing revokes previous tokens and retains library and preference data.

| Method and path | Request / response |
| --- | --- |
| GET `/api/sync/identity` | `{user_id, email}` |
| GET `/api/sync/status` | Connection and Drive configuration flags |
| GET `/api/sync/prompt-link` | `{chatgpt_prompt_link: string or null}` |
| PUT `/api/sync/prompt-link` | Required `chatgpt_prompt_link`; HTTP(S) URL or null; returns normalized value; invalid input returns 422 |
| POST `/api/sync/videos` | Companion `_payload(video)`; returns `{synced, id, drive_uploads}` or `{synced: true, deleted: true}` for stale resurrection |
| DELETE `/api/sync/videos/:videoId` | Creates owner-scoped tombstone and deletes the record; returns `{synced: true}` |
| GET `/api/sync/library?offset=0` | `{items, channel_tags, next_offset}`; includes tags, watch state, pause state, ChatGPT and Drive links, and update timestamp |
| GET `/api/sync/drive-links?offset=0` | `{items, next_offset}` for completed Drive links |
| GET `/api/sync/youtube/status` | Paired owner's playlist connection status |
| GET `/api/sync/youtube/playlist?playlist_id=...` | Managed playlist lookup |
| POST `/api/sync/youtube/retry` | Retry pending playlist cleanup |
| POST `/api/sync/youtube/disconnect` | Disconnect paired owner's YouTube connection |

Library pages contain at most 200 rows. Continue with `next_offset` until null. A complete valid snapshot is required before local reconciliation. Pending local edits remain in the durable outbox; acknowledged remote deletion wins over offline edits. Old uploads cannot resurrect a tombstoned video. Captions are checkpointed separately from Drive uploads, whose reserved IDs survive restart.

`e2e/workflows.spec.ts` verifies the built Worker contract with a real D1 emulator and invokes `backend/tests/test_sites_contract.py` to test the actual Python adapter. Companion tests additionally exercise durable delivery failure, reconnect, pull-without-echo, deletion, and user isolation. External YouTube/Drive responses are fixtures; these checks do not establish live account or hosted deployment connectivity.
