import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeEach, expect, test, vi } from "vitest";
import { env } from "./worker-env";

const context = vi.hoisted(() => ({ db: null as unknown as D1Database, retry: vi.fn(), readPage: vi.fn() }));
vi.mock("../lib/server-api", () => ({ database: () => context.db, retryVideo: context.retry }));
vi.mock("../lib/youtube-playlists", () => ({ processOnePlaylistRemoval: vi.fn(), readManagedPlaylistPage: context.readPage }));
import { encryptTokens, syncOnePendingSubtitle, uploadSubtitle } from "../lib/drive-service";
import { runHostedJobs } from "../lib/hosted-jobs";
import { processOnePlaylistImport } from "../lib/playlist-imports";

let sqlite: DatabaseSync;
let files: Map<string, string>;
let loseResponse: boolean;
let failConfirmation: boolean;

beforeEach(async () => {
  vi.restoreAllMocks();
  context.retry.mockReset();
  context.readPage.mockReset();
  sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync("drizzle").filter(name => name.endsWith(".sql")).sort()) sqlite.exec(readFileSync(`drizzle/${file}`, "utf8"));
  context.db = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...args: unknown[]) { values = args; return statement; },
        async first() { return sqlite.prepare(sql).get(...values as never[]) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...values as never[]) }; },
        async run() {
          if (failConfirmation && sql.includes("SET drive_file_id =")) { failConfirmation = false; throw new Error("D1 interrupted"); }
          return { meta: sqlite.prepare(sql).run(...values as never[]) };
        },
      };
      return statement;
    },
    async batch(statements: Array<{run(): Promise<{meta: {changes: number}}>}>) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  } as unknown as D1Database;
  env.GOOGLE_CLIENT_ID = "test";
  env.GOOGLE_CLIENT_SECRET = "test";
  env.GOOGLE_TOKEN_ENCRYPTION_KEY = btoa("a".repeat(32));
  sqlite.prepare("INSERT INTO drive_connections(user_id, encrypted_credentials) VALUES (?, ?)").run("user", await encryptTokens({ access_token: "access", refresh_token: "refresh", expires_at: Date.now() + 3600000, scope: "drive.file" }));
  sqlite.exec("INSERT INTO videos(user_id, video_id, youtube_url, title, status, subtitle_text) VALUES ('user','video','https://youtube.com/watch?v=video','Test','COMPLETED','saved captions')");
  files = new Map(); loseResponse = false; failConfirmation = false;
  let sequence = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("generateIds")) return Response.json({ ids: [`reserved-${++sequence}`] });
    if (url.includes("uploadType")) {
      const metadata = JSON.parse(String(init?.body).split("\r\n\r\n")[1].split("\r\n--")[0]);
      if (files.has(metadata.id)) return new Response("conflict", { status: 409 });
      files.set(metadata.id, String(init?.body));
      if (loseResponse) { loseResponse = false; throw new Error("Upload timed out after remote success"); }
      return Response.json({ id: metadata.id });
    }
    if (url.includes("?q=")) return Response.json({ files: [{ id: "folder" }] });
    const id = url.split("/files/")[1]?.split("?")[0];
    return id && files.has(id) ? Response.json({ id, webViewLink: `https://drive.google.com/file/d/${id}/view` }) : new Response("missing", { status: 404 });
  }));
});

test("timeout and restart reconcile one file using stored captions", async () => {
  loseResponse = true;
  await syncOnePendingSubtitle("user");
  sqlite.exec("UPDATE videos SET drive_last_attempt_at = NULL");
  await syncOnePendingSubtitle("user");
  expect(files.size).toBe(1);
  expect([...files.values()][0]).toContain("saved captions");
  expect(sqlite.prepare("SELECT drive_file_id, drive_file_url FROM videos").get()).toEqual({ drive_file_id: "reserved-1", drive_file_url: "https://drive.google.com/file/d/reserved-1/view" });
});

test("previously attempted Drive uploads become eligible after backoff", async () => {
  sqlite.prepare("UPDATE videos SET drive_retry_count = 1, drive_last_attempt_at = ? WHERE user_id = 'user'")
    .run(new Date(Date.now() - 20_000).toISOString());
  await syncOnePendingSubtitle("user");
  expect(files.size).toBe(1);
  expect(sqlite.prepare("SELECT drive_file_id, drive_retry_count FROM videos WHERE user_id = 'user'").get())
    .toMatchObject({ drive_file_id: "reserved-1", drive_retry_count: 2 });
});

test("database confirmation loss reuses the reserved file", async () => {
  failConfirmation = true;
  await syncOnePendingSubtitle("user");
  sqlite.exec("UPDATE videos SET drive_last_attempt_at = NULL");
  await syncOnePendingSubtitle("user");
  expect(files.size).toBe(1);
  expect(sqlite.prepare("SELECT drive_file_id FROM videos").get()?.drive_file_id).toBe("reserved-1");
});

test("concurrent uploads persist one winning identity and reconcile conflicts", async () => {
  const results = await Promise.all([uploadSubtitle("user", "Test", "saved captions", 1), uploadSubtitle("user", "Test", "saved captions", 1)]);
  expect(files.size).toBe(1);
  expect(results[0].id).toBe(results[1].id);
});

test("overlapping workers claim exclusively; expired claims recover", async () => {
  sqlite.exec("UPDATE videos SET status = 'PROCESSING'");
  let release!: () => void;
  context.retry.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const first = runHostedJobs();
  await vi.waitFor(() => expect(context.retry).toHaveBeenCalledTimes(1));
  await runHostedJobs();
  expect(context.retry).toHaveBeenCalledTimes(1);
  release(); await first;
  sqlite.exec("UPDATE hosted_job_leases SET owner = 'crashed', lease_until = 0");
  await runHostedJobs();
  expect(context.retry).toHaveBeenCalledTimes(2);
});

test("scheduler health retains per-user processing failures", async () => {
  sqlite.exec("INSERT INTO videos (user_id, video_id, youtube_url, title, status) VALUES ('broken-user','broken00001','https://youtube.com','Broken','PROCESSING')");
  context.retry.mockRejectedValueOnce(new Error("fixture download failure"));
  await runHostedJobs();
  expect(sqlite.prepare("SELECT last_status, last_error FROM hosted_scheduler_state WHERE id = 1").get())
    .toEqual({ last_status: "partial_failure", last_error: "broken-user: fixture download failure" });
});

test("previously attempted caption jobs become eligible after backoff", async () => {
  sqlite.prepare(`INSERT INTO videos (user_id, video_id, youtube_url, title, status, retry_count, last_attempt_at)
    VALUES ('retried-caption', 'caption0001', 'https://youtube.com', 'Retried caption', 'PROCESSING', 4, ?)`)
    .run(new Date(Date.now() - 120_000).toISOString());
  await runHostedJobs();
  expect(context.retry).toHaveBeenCalledWith(expect.any(Number), "retried-caption");
});

test("scheduler only picks due work with prerequisites and rotates fairly across users", async () => {
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 60_000).toISOString();
  sqlite.prepare(`INSERT INTO videos (user_id, video_id, youtube_url, title, status, last_attempt_at, retry_count)
    VALUES ('future', 'future01', 'https://youtube.com', 'Future', 'PROCESSING', ?, 3)`).run(future);
  sqlite.prepare(`INSERT INTO videos (user_id, video_id, youtube_url, title, status, processing_paused)
    VALUES ('paused', 'paused01', 'https://youtube.com', 'Paused', 'PROCESSING', 1)` ).run();
  sqlite.prepare(`INSERT INTO videos (user_id, video_id, youtube_url, title, status, processing_source)
    VALUES ('local', 'local0001', 'https://youtube.com', 'Local', 'PROCESSING', 'LOCAL')`).run();
  sqlite.prepare(`INSERT INTO videos (user_id, video_id, youtube_url, title, status, subtitle_text, drive_retry_count, drive_last_attempt_at)
    VALUES ('drive-future', 'drive000001', 'https://youtube.com', 'Drive future', 'COMPLETED', 'captions', 4, ?)` ).run(future);
  sqlite.prepare("INSERT INTO drive_connections (user_id, encrypted_credentials) VALUES ('drive-future', 'unused')").run();
  sqlite.prepare(`INSERT INTO videos (user_id, video_id, youtube_url, title, status, subtitle_text)
    VALUES ('youtube-unlinked', 'youtub00001', 'https://youtube.com', 'YouTube unlinked', 'COMPLETED', 'captions')`).run();
  sqlite.prepare(`INSERT INTO playlist_cleanup_jobs (user_id, video_id, playlist_id, playlist_item_id, updated_at)
    VALUES ('youtube-unlinked', 'youtub00001', 'playlist-x', 'cleanup-unlinked', ?)` ).run(now);
  sqlite.prepare(`INSERT INTO videos (user_id, video_id, youtube_url, title, status, subtitle_text)
    VALUES ('youtube-future', 'youtub00002', 'https://youtube.com', 'YouTube future', 'COMPLETED', 'captions')`).run();
  sqlite.prepare("INSERT INTO youtube_connections (user_id, encrypted_credentials, updated_at) VALUES ('youtube-future', 'unused', ?)").run(now);
  sqlite.prepare(`INSERT INTO playlist_cleanup_jobs (user_id, video_id, playlist_id, playlist_item_id, next_attempt, updated_at)
    VALUES ('youtube-future', 'youtub00002', 'playlist-x', 'cleanup-future', ?, ?)` ).run(Date.now() + 60_000, now);
  for (let i = 0; i < 6; i++) sqlite.prepare(`INSERT INTO videos (user_id, video_id, youtube_url, title, status)
    VALUES (?, ?, 'https://youtube.com', ?, 'PROCESSING')`).run(`fair-${i}`, `fair${String(i).padStart(7, "0")}`, `Fair ${i}`);
  context.retry.mockImplementation(async (id: number, userId: string) => {
    sqlite.prepare("UPDATE videos SET retry_count = retry_count + 1, last_attempt_at = ? WHERE id = ? AND user_id = ?")
      .run(new Date().toISOString(), id, userId);
  });

  await runHostedJobs();
  expect(context.retry.mock.calls.map(call => call[1]).sort()).toEqual(["fair-0", "fair-1", "fair-2", "fair-3"]);
  context.retry.mockClear();
  await runHostedJobs();
  expect(context.retry.mock.calls.map(call => call[1]).sort()).toEqual(["fair-4", "fair-5"]);
  expect(context.retry).not.toHaveBeenCalledWith(expect.anything(), "future");
  expect(context.retry).not.toHaveBeenCalledWith(expect.anything(), "paused");
  expect(context.retry).not.toHaveBeenCalledWith(expect.anything(), "local");
  expect(sqlite.prepare("SELECT user_id FROM hosted_job_leases WHERE user_id IN ('drive-future','youtube-unlinked','youtube-future')").all()).toEqual([]);
});

test("durable playlist items resume and repeated submissions preserve tags and cleanup jobs", async () => {
  const now = new Date().toISOString();
  sqlite.prepare(`INSERT INTO playlist_imports (id, user_id, playlist_id, title, total_items, state, discovery_complete, created_at, updated_at)
    VALUES ('import-a', 'user', 'playlist-a', 'Playlist', 1, 'PENDING', 1, ?, ?)`).run(now, now);
  sqlite.prepare(`INSERT INTO playlist_import_items
    (import_id, user_id, video_id, title, playlist_id, playlist_item_id, tags_json, created_at)
    VALUES ('import-a', 'user', 'abcdefghijk', 'Imported', 'playlist-a', 'item-a', '["Playlist"]', ?)` ).run(now);
  sqlite.prepare("UPDATE playlist_import_items SET state = 'PROCESSING', lease_until = 0 WHERE import_id = 'import-a'").run();

  expect((await Promise.all([processOnePlaylistImport("user"), processOnePlaylistImport("user")])).filter(Boolean)).toHaveLength(1);
  expect(sqlite.prepare("SELECT state, completed_items FROM playlist_imports WHERE id = 'import-a'").get())
    .toEqual({ state: "COMPLETED", completed_items: 1 });

  sqlite.prepare(`INSERT INTO videos (user_id, video_id, youtube_url, title, status, tags_json, channel_tags)
    VALUES ('user', 'zyxwvutsrqp', 'https://youtube.com/watch?v=zyxwvutsrqp', 'Existing', 'COMPLETED', '["Keep"]', 'Keep')`).run();
  sqlite.prepare(`INSERT INTO playlist_imports (id, user_id, playlist_id, title, total_items, state, discovery_complete, created_at, updated_at)
    VALUES ('import-b', 'user', 'playlist-a', 'Playlist', 1, 'PENDING', 1, ?, ?)`).run(now, now);
  sqlite.prepare(`INSERT INTO playlist_import_items
    (import_id, user_id, video_id, title, playlist_id, playlist_item_id, tags_json, created_at)
    VALUES ('import-b', 'user', 'zyxwvutsrqp', 'Replacement', 'playlist-a', 'item-a', '["Playlist"]', ?)` ).run(now);
  expect(await processOnePlaylistImport("user")).toBe(true);
  const existing = sqlite.prepare("SELECT id, title, status, tags_json FROM videos WHERE video_id = 'zyxwvutsrqp'").get();
  expect(existing).toMatchObject({ title: "Existing", status: "COMPLETED", tags_json: expect.stringContaining("Keep") });
  expect(existing?.tags_json).toContain("Playlist");
  expect(sqlite.prepare("SELECT count(*) AS count FROM videos WHERE user_id = 'user' AND video_id = 'zyxwvutsrqp'").get()?.count).toBe(1);
  expect(sqlite.prepare("SELECT count(*) AS count FROM playlist_cleanup_jobs WHERE user_id = 'user' AND playlist_item_id = 'item-a'").get()?.count).toBe(1);
});

test("playlist discovery checkpoints each page and resumes from its saved token", async () => {
  const now = new Date().toISOString();
  sqlite.prepare(`INSERT INTO playlist_imports (id, user_id, playlist_id, title, tags_json, total_items, state, created_at, updated_at)
    VALUES ('discover-a', 'user', 'playlist-a', 'playlist-a', '["Imported"]', 0, 'DISCOVERING', ?, ?)`).run(now, now);
  context.readPage.mockResolvedValueOnce({ title: "Playlist A", nextPageToken: "next-page", videos: [
    { video_id: "abcdefghijk", playlist_item_id: "item-a", title: "First", channel_title: null, channel_url: null, thumbnail_url: null, duration: null },
  ] }).mockResolvedValueOnce({ title: null, nextPageToken: null, videos: [
    { video_id: "zyxwvutsrqp", playlist_item_id: "item-b", title: "Second", channel_title: null, channel_url: null, thumbnail_url: null, duration: null },
  ] });

  expect(await processOnePlaylistImport("user")).toBe(false);
  const { processOnePlaylistDiscovery } = await import("../lib/playlist-imports");
  expect(await processOnePlaylistDiscovery("user")).toBe(true);
  expect(sqlite.prepare("SELECT next_page_token, total_items, state FROM playlist_imports WHERE id = 'discover-a'").get())
    .toEqual({ next_page_token: "next-page", total_items: 1, state: "DISCOVERING" });
  expect(await processOnePlaylistDiscovery("user")).toBe(true);
  expect(sqlite.prepare("SELECT next_page_token, total_items, state, discovery_complete FROM playlist_imports WHERE id = 'discover-a'").get())
    .toEqual({ next_page_token: null, total_items: 2, state: "PENDING", discovery_complete: 1 });
  expect(sqlite.prepare("SELECT count(*) AS count FROM playlist_import_items WHERE import_id = 'discover-a'").get()?.count).toBe(2);
  expect(context.readPage.mock.calls.map(call => call[2])).toEqual([null, "next-page"]);
});
