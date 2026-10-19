import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
let sqlite;
let uploads;
let failUpload;
let signedIn;
const adapter = {
  prepare(sql) { let args = []; return { bind(...values) { args = values; return this; },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }; },
  }; },
  async batch(statements) { return Promise.all(statements.map(s => s.run())); },
};
globalThis.__db = adapter;
globalThis.__identity = () => signedIn ? "owner" : null;
globalThis.__upload = async () => { uploads++; if (failUpload) throw new Error("Drive offline"); return { id: "saved-file" }; };
async function moduleAt(path, drive = false) {
  let source = readFileSync(new URL("../" + path, import.meta.url), "utf8").replace(/^import .*;\r?\n/gm, "");
  if (drive) source = source.replace(/export async function uploadSubtitle[\s\S]*?(?=export async function disconnectDrive)/, "export const uploadSubtitle = (...args) => globalThis.__upload(...args);\n");
  source = `const database = () => globalThis.__db;
    const env = { GOOGLE_CLIENT_ID: 'test', GOOGLE_CLIENT_SECRET: 'test', GOOGLE_TOKEN_ENCRYPTION_KEY: 'test' };
    const authenticatedLocalUser = async () => globalThis.__identity();
    const currentSiteUser = async () => globalThis.__identity() ? { userId: globalThis.__identity() } : null;
    const json = value => Response.json(value);
    const errorResponse = (detail, status = 400) => Response.json({detail}, {status});
    const videoFromRow = row => row;
    const syncOnePendingSubtitle = async () => null;\n` + source;
  if (drive) source = source.replace("const syncOnePendingSubtitle = async () => null;", "");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64") + "#" + Math.random());
}
beforeEach(() => {
  sqlite?.close(); sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../drizzle/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL("../drizzle/" + file, import.meta.url), "utf8"));
  uploads = 0; failUpload = false; signedIn = true;
});
const video = { video_id: "abcdefghijk", youtube_url: "https://youtu.be/abcdefghijk", title: "Saved", status: "COMPLETED", watch_status: "TO_DO", subtitle_type: "MANUAL", subtitle_text: "Durable captions", retry_count: 0, created_at: "2020-01-01T00:00:00Z", updated_at: "2020-01-01T00:00:00Z" };
const request = body => new Request("https://example.com/api/sync/videos", {method: "POST", body: JSON.stringify(body)});
test("idempotent upsert, delete and stale replay across re-pairing", async () => {
  const sync = await moduleAt("app/api/sync/videos/route.ts");
  const removal = await moduleAt("app/api/sync/videos/[videoId]/route.ts");
  await sync.POST(request(video)); await sync.POST(request(video));
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM videos").get().n, 1);
  await removal.DELETE(new Request("https://example.com"), {params: Promise.resolve({videoId: video.video_id})});
  signedIn = false; assert.equal((await sync.POST(request(video))).status, 401); signedIn = true;
  assert.equal((await (await sync.POST(request({...video, updated_at: "2030-01-01T00:00:00Z"}))).json()).deleted, true);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM videos").get().n, 0);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM sync_tombstones").get().n, 1);
});
test("Drive outage retries saved subtitle independently and respects pause", async () => {
  const sync = await moduleAt("app/api/sync/videos/route.ts"); await sync.POST(request(video));
  sqlite.prepare("INSERT INTO drive_connections (user_id, encrypted_credentials) VALUES ('owner', 'unused')").run();
  let drive = await moduleAt("lib/drive-service.ts", true); failUpload = true;
  await drive.syncOnePendingSubtitle("owner");
  let row = sqlite.prepare("SELECT * FROM videos").get();
  assert.equal(row.status, "COMPLETED"); assert.equal(row.subtitle_text, "Durable captions"); assert.equal(row.error_category, "DRIVE_UPLOAD");
  sqlite.prepare("UPDATE videos SET processing_paused = 1, drive_last_attempt_at = NULL").run();
  drive = await moduleAt("lib/drive-service.ts", true); await drive.syncOnePendingSubtitle("owner"); assert.equal(uploads, 1);
  sqlite.prepare("UPDATE videos SET processing_paused = 0").run(); failUpload = false;
  await drive.syncOnePendingSubtitle("owner"); row = sqlite.prepare("SELECT * FROM videos").get();
  assert.equal(uploads, 2); assert.equal(row.drive_file_id, "saved-file"); assert.equal(row.subtitle_text, "Durable captions");
});
