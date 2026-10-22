import assert from "node:assert/strict";
import { Miniflare, Response } from "miniflare";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const state = mkdtempSync(path.join(tmpdir(), "youtube-worker-recovery-"));
const driveFiles = new Map();
let generatedId = 0;
let captionDownloads = 0;
let uploadRequests = 0;
const options = {
  modules: ["index.js", ...readdirSync("dist/server", { recursive: true })
    .filter(name => name !== "index.js" && /\.(?:m?js)$/.test(name))]
    .map(name => ({ type: "ESModule", path: path.resolve("dist/server", name) })),
  modulesRoot: path.resolve("dist/server"),
  compatibilityDate: "2026-05-15",
  compatibilityFlags: ["nodejs_compat"],
  d1Databases: ["DB"],
  d1Persist: state,
  bindings: {
    GOOGLE_CLIENT_ID: "fixture-client",
    GOOGLE_CLIENT_SECRET: "fixture-secret",
    GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 91).toString("base64url"),
  },
  outboundService: async request => {
    const url = new URL(request.url);
    if (url.hostname === "www.googleapis.com") {
      if (url.pathname.endsWith("generateIds")) return Response.json({ ids: [`drive-${++generatedId}`] });
      if (url.pathname.includes("/upload/")) {
        const body = await request.text();
        const metadata = JSON.parse(body.split("\r\n\r\n")[1].split("\r\n--")[0]);
        uploadRequests++;
        if (driveFiles.has(metadata.id)) return new Response("conflict", { status: 409 });
        driveFiles.set(metadata.id, body);
        return Response.json({ id: metadata.id, webViewLink: `https://drive.google.com/file/d/${metadata.id}/view` });
      }
      if (url.searchParams.has("q")) return Response.json({ files: [{ id: "fixture-folder" }] });
      const id = url.pathname.split("/").pop();
      return driveFiles.has(id)
        ? Response.json({ id, webViewLink: `https://drive.google.com/file/d/${id}/view` })
        : new Response("missing", { status: 404 });
    }
    if (url.hostname.endsWith("youtube.com")) {
      if (url.pathname.includes("timedtext")) captionDownloads++;
      return new Response("fixture has no captions", { status: 404 });
    }
    throw new Error(`Unexpected external request: ${url}`);
  },
};

let runtime;
let db;
async function startRuntime() {
  runtime = new Miniflare(options);
  db = await runtime.getD1Database("DB");
  return runtime.getWorker();
}
async function runScheduled(worker) {
  const result = await worker.scheduled({ cron: "* * * * *" });
  assert.equal(result.outcome, "ok", `scheduled Worker returned ${result.outcome}`);
}
async function migrate() {
  for (const file of readdirSync("drizzle").filter(name => name.endsWith(".sql")).sort()) {
    for (const sql of readFileSync(path.join("drizzle", file), "utf8").split(";").filter(sql => sql.trim())) {
      await db.prepare(sql).run();
    }
  }
}
async function encryptTokens() {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", Buffer.alloc(32, 91), "AES-GCM", false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key,
    new TextEncoder().encode(JSON.stringify({ access_token: "fixture", refresh_token: "fixture", expires_at: Date.now() + 3_600_000, scope: "drive.file" })));
  return `${Buffer.from(iv).toString("base64url")}.${Buffer.from(ciphertext).toString("base64url")}`;
}

try {
  await startRuntime();
  await migrate();
  const now = new Date().toISOString();
  const importId = "populated-playlist-import";
  await db.prepare(`INSERT INTO playlist_imports (id, user_id, playlist_id, title, total_items, state, discovery_complete, created_at, updated_at)
    VALUES (?, 'playlist-user', 'playlist-100', '100 video playlist', 100, 'PENDING', 1, ?, ?)`).bind(importId, now, now).run();
  const items = [];
  for (let index = 0; index < 100; index++) {
    const videoId = `pl${String(index).padStart(9, "0")}`;
    const itemState = index < 5 ? "PROCESSING" : "PENDING";
    items.push(db.prepare(`INSERT INTO playlist_import_items
      (import_id, user_id, video_id, title, playlist_id, playlist_item_id, tags_json, state, lease_until, created_at)
      VALUES (?, 'playlist-user', ?, ?, 'playlist-100', ?, '["100 video playlist"]', ?, 0, ?)`)
      .bind(importId, videoId, `Playlist video ${index}`, `item-${index}`, itemState, now));
  }
  await db.batch(items);
  await db.prepare(`INSERT INTO videos (user_id, video_id, youtube_url, title, status, retry_count, last_attempt_at)
    VALUES ('caption-retry-user', 'captry00001', 'https://youtube.com/watch?v=captry00001', 'Previously attempted captions', 'PROCESSING', 3, ?)`)
    .bind(new Date(Date.now() - 120_000).toISOString()).run();

  // Two simultaneous cron invocations compete for a populated import. Each
  // invocation is bounded and repeated claims must never duplicate video rows.
  let worker = await runtime.getWorker();
  await Promise.all([runScheduled(worker), runScheduled(worker)]);
  let progress = await db.prepare(`SELECT count(*) AS completed FROM playlist_import_items WHERE import_id = ? AND state = 'COMPLETED'`)
    .bind(importId).first();
  assert.equal(Number(progress.completed), 20, "two overlapping runs should process at most two bounded batches");
  assert.equal(Number((await db.prepare("SELECT count(*) AS count FROM videos WHERE user_id = 'playlist-user'").first()).count), 20);

  // Recreate the Worker against persisted D1 to model a process restart, then
  // continue all remaining items without re-creating existing video rows.
  await runtime.dispose();
  worker = await startRuntime();
  for (let run = 0; run < 8; run++) await runScheduled(worker);
  progress = await db.prepare(`SELECT state, completed_items FROM playlist_imports WHERE id = ?`).bind(importId).first();
  assert.deepEqual(progress, { state: "COMPLETED", completed_items: 100 });
  assert.equal(Number((await db.prepare("SELECT count(*) AS count FROM videos WHERE user_id = 'playlist-user'").first()).count), 100);
  assert.equal(Number((await db.prepare("SELECT count(*) AS count FROM playlist_import_items WHERE import_id = ? AND state = 'COMPLETED'").bind(importId).first()).count), 100);
  const retriedCaption = await db.prepare("SELECT retry_count FROM videos WHERE user_id = 'caption-retry-user'").first();
  assert.ok(Number(retriedCaption.retry_count) > 3, "a previously attempted caption job should become due after restart");

  // Populate a completed caption record and simulate a database interruption
  // after Drive accepts the upload but before D1 confirms its file ID.
  const encrypted = await encryptTokens();
  await db.prepare("INSERT INTO drive_connections(user_id, encrypted_credentials) VALUES ('drive-user', ?)").bind(encrypted).run();
  await db.prepare(`INSERT INTO videos (user_id, video_id, youtube_url, title, status, subtitle_text, subtitle_type)
    VALUES ('drive-user', 'drivevideo01', 'https://youtube.com/watch?v=drivevideo01', 'Saved captions', 'COMPLETED', 'existing saved captions', 'AUTO')`).run();
  await db.prepare(`CREATE TRIGGER interrupt_drive_confirmation BEFORE UPDATE OF drive_file_id ON videos
    WHEN NEW.drive_file_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'simulated D1 confirmation loss'); END`).run();
  await runScheduled(worker);
  let driveRow = await db.prepare("SELECT drive_file_id, drive_upload_id, subtitle_text FROM videos WHERE user_id = 'drive-user'").first();
  assert.equal(driveRow.drive_file_id, null);
  assert.ok(driveRow.drive_upload_id, "reserved Drive ID should survive the failed confirmation");
  assert.equal(driveFiles.size, 1, "Drive accepted exactly one file before confirmation failed");

  await db.prepare("DROP TRIGGER interrupt_drive_confirmation").run();
  await db.prepare("UPDATE videos SET drive_last_attempt_at = ? WHERE user_id = 'drive-user'")
    .bind(new Date(Date.now() - 20_000).toISOString()).run();
  await runtime.dispose();
  worker = await startRuntime();
  await runScheduled(worker);
  driveRow = await db.prepare("SELECT drive_file_id, drive_upload_id, subtitle_text FROM videos WHERE user_id = 'drive-user'").first();
  assert.equal(driveRow.drive_file_id, driveRow.drive_upload_id);
  assert.equal(driveFiles.size, 1, "restart recovery must not create a second Drive file");
  assert.equal(captionDownloads, 0, "Drive-only recovery must reuse saved subtitle text");
  assert.equal(uploadRequests, 1, "Drive-only recovery must reconcile the existing upload ID");
  console.log("Built Worker D1 recovery: overlapping claims, expired import leases, restart resume, unique videos, and lost Drive confirmation passed");
} finally {
  await runtime?.dispose();
  rmSync(state, { recursive: true, force: true });
}
