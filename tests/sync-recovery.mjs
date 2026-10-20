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
    const json = (value, status = 200) => Response.json(value, {status});
    const errorResponse = (detail, status = 400) => Response.json({detail}, {status});
    const videoFromRow = row => ({...row, tags: row.tags_json != null ? JSON.parse(row.tags_json) : (row.channel_tags || "").split(",").map(t => t.trim()).filter(Boolean)});
    const youtubeFetch = (...args) => globalThis.__youtube(...args);
    const readPlaylist = (...args) => globalThis.__playlist(...args);
    const retryVideo = async () => {};
    const syncOnePendingSubtitle = async () => null;\n` + source;
  if (path === "lib/playlist.ts") {
    source = source.replace("const readPlaylist = (...args) => globalThis.__playlist(...args);", "");
    const server = readFileSync(new URL("../lib/server-api.ts", import.meta.url), "utf8");
    source += "\n" + server.slice(server.indexOf("export function readEmbeddedJson"), server.indexOf("function readInitialPlayerResponse(html:")).replace("export function", "function");
  }
  if (drive) source = source.replace("const syncOnePendingSubtitle = async () => null;", "");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64") + "#" + Math.random());
}
beforeEach(() => {
  sqlite?.close(); sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../drizzle/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL("../drizzle/" + file, import.meta.url), "utf8"));
  uploads = 0; failUpload = false; signedIn = true;
  globalThis.__youtube = async () => Response.json({title: "Single fixture", author_name: "Shared"});
  globalThis.__playlist = async () => ({title: "English, AI & Learning", videos: ["abcdefghijk", "bcdefghijkl"].map(video_id => ({video_id, title: video_id, channel_title: "Shared", channel_url: null, thumbnail_url: null, duration: 10}))});
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



test("video tags remain independent across sync and editing", async () => {
  const sync = await moduleAt("app/api/sync/videos/route.ts");
  const edit = await moduleAt("app/api/videos/[id]/route.ts");
  const removed = await moduleAt("app/api/videos/channel-tags/route.ts");
  await sync.POST(request({...video, channel_title: "Shared", tags: ["English, AI & Learning"]}));
  await sync.POST(request({...video, video_id: "bcdefghijkl", channel_title: "Shared", tags: ["other"]}));
  await edit.PATCH(request({tags: ["new"]}), {params: Promise.resolve({id: "1"})});
  assert.deepEqual(sqlite.prepare("SELECT tags_json FROM videos ORDER BY id").all().map(r => JSON.parse(r.tags_json)), [["new"], ["other"]]);
  assert.equal((await removed.POST(request({channel_title: "Shared", tags: "bad"}))).status, 410);
  await edit.PATCH(request({tags: []}), {params: Promise.resolve({id: "1"})});
  assert.deepEqual(sqlite.prepare("SELECT tags_json FROM videos ORDER BY id").all().map(r => JSON.parse(r.tags_json)), [[], ["other"]]);
});

test("import modes assign manual tags or the exact playlist name, including duplicates", async () => {
  const ingest = await moduleAt("app/api/videos/route.ts");
  let response = await ingest.POST(request({mode: "video", url: "https://www.youtube.com/watch?v=abcdefghijk&list=PLignored", tags: ["Chosen"]}));
  assert.equal(response.status, 202);
  assert.deepEqual((await response.json()).results[0].video.tags, ["Chosen"]);
  response = await ingest.POST(request({mode: "playlist", url: "https://www.youtube.com/watch?v=abcdefghijk&list=PLfixture", tags: ["ignored"]}));
  assert.equal(response.status, 202);
  const body = await response.json(); assert.equal(body.skipped_duplicates, 1);
  assert.deepEqual(sqlite.prepare("SELECT tags_json FROM videos ORDER BY id").all().map(r => JSON.parse(r.tags_json)), [["Chosen", "English, AI & Learning"], ["English, AI & Learning"]]);
  response = await ingest.GET(new Request("https://example.com/api/videos?tag="+encodeURIComponent("English, AI & Learning")));
  assert.equal((await response.json()).total, 2);
});

test("playlist extraction follows continuation pages and preserves the title", async () => {
  const playlist = await moduleAt("lib/playlist.ts");
  const renderer = id => ({playlistVideoRenderer: {videoId: id, title: {simpleText: id}, isPlayable: true}});
  const data = {metadata: {playlistMetadataRenderer: {title: "English, AI & Learning"}}, contents: {playlistVideoListRenderer: {contents: [renderer("abcdefghijk"), {continuationItemRenderer: {continuationEndpoint: {continuationCommand: {token: "NEXT"}}}}]}}};
  let calls = 0;
  globalThis.__youtube = async (_url, init) => {
    calls++;
    if (!init?.method) return new Response("var ytInitialData = " + JSON.stringify(data) + ";");
    assert.equal(JSON.parse(init.body).continuation, "NEXT");
    return Response.json({onResponseReceivedActions: [{appendContinuationItemsAction: {continuationItems: [renderer("bcdefghijkl")]}}]});
  };
  const result = await playlist.readPlaylist("PLfixture");
  assert.equal(calls, 2); assert.equal(result.title, "English, AI & Learning");
  assert.deepEqual(result.videos.map(v => v.video_id), ["abcdefghijk", "bcdefghijkl"]);
});
