import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeEach, expect, test, vi } from "vitest";
import { env } from "./worker-env";

const context = vi.hoisted(() => ({ db: null as unknown as D1Database, retry: vi.fn() }));
vi.mock("../lib/server-api", () => ({ database: () => context.db, retryVideo: context.retry }));
vi.mock("../lib/youtube-playlists", () => ({ processOnePlaylistRemoval: vi.fn() }));
import { encryptTokens, syncOnePendingSubtitle, uploadSubtitle } from "../lib/drive-service";
import { runHostedJobs } from "../lib/hosted-jobs";

let sqlite: DatabaseSync;
let files: Map<string, string>;
let loseResponse: boolean;
let failConfirmation: boolean;

beforeEach(async () => {
  vi.restoreAllMocks();
  context.retry.mockReset();
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
