import { Miniflare, Response } from "miniflare";
import { createServer } from "node:http";
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Test-only host: production code has no fixture routes or external-service bypasses.
const state = mkdtempSync(path.join(tmpdir(), "youtube-release-e2e-"));
const files = new Map();
let uploads = 0, captions = 0, sequence = 0;
const options = {
  modules: ["index.js", ...readdirSync("dist/server", { recursive: true }).filter(n => n !== "index.js" && /\.(?:m?js)$/.test(n))]
    .map(n => ({ type: "ESModule", path: path.resolve("dist/server", n) })),
  modulesRoot: path.resolve("dist/server"), compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"],
  d1Databases: ["DB"], d1Persist: state,
  bindings: { HOSTED_JOBS_TOKEN: "browser-test", GOOGLE_CLIENT_ID: "fixture", GOOGLE_CLIENT_SECRET: "fixture", GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 97).toString("base64url") },
  outboundService: async request => {
    const url = new URL(request.url);
    if (url.hostname.endsWith("youtube.com")) {
      if (url.pathname === "/oembed") return Response.json({ title: "Release workflow video", author_name: "Fixture channel" });
      if (url.pathname.includes("timedtext")) { captions++; return new Response('WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nSaved release captions\n'); }
      const player = { playabilityStatus: {status: "OK"}, videoDetails: {title: "Release workflow video", lengthSeconds: "2"}, captions: {playerCaptionsTracklistRenderer: {captionTracks: [{languageCode: "en", baseUrl: "https://www.youtube.com/api/timedtext?v=release0001"}]}} };
      return url.pathname.includes("youtubei") ? Response.json(player) : new Response(`var ytInitialPlayerResponse = ${JSON.stringify(player)};`);
    }
    if (url.hostname === "www.googleapis.com") {
      if (url.pathname.endsWith("generateIds")) return Response.json({ids: [`fixture-${++sequence}`]});
      if (url.pathname.includes("/upload/")) {
        const body = await request.text();
        const metadata = JSON.parse(body.split("\r\n\r\n")[1].split("\r\n--")[0]);
        uploads++;
        if (files.has(metadata.id)) return new Response("conflict", {status: 409});
        files.set(metadata.id, body);
        return Response.json({id: metadata.id, webViewLink: `https://drive.google.com/file/d/${metadata.id}/view`});
      }
      if (url.searchParams.has("q")) return Response.json({files: [{id: "folder"}]});
      const id = url.pathname.split("/").pop();
      return files.has(id) ? Response.json({id, webViewLink: `https://drive.google.com/file/d/${id}/view`}) : new Response("missing", {status: 404});
    }
    throw new Error(`Unexpected external request: ${url}`);
  },
};
let runtime = new Miniflare(options);
let db = await runtime.getD1Database("DB");
for (const file of readdirSync("drizzle").filter(n => n.endsWith(".sql")).sort()) {
  for (const sql of readFileSync(path.join("drizzle", file), "utf8").split(";").filter(s => s.trim())) await db.prepare(sql).run();
}
const iv = crypto.getRandomValues(new Uint8Array(12));
const key = await crypto.subtle.importKey("raw", Buffer.alloc(32, 97), "AES-GCM", false, ["encrypt"]);
const encrypted = await crypto.subtle.encrypt({name: "AES-GCM", iv}, key, new TextEncoder().encode(JSON.stringify({access_token: "fixture", refresh_token: "fixture", expires_at: Date.now() + 3600000, scope: "drive.file"})));
await db.prepare("INSERT INTO drive_connections(user_id, encrypted_credentials) VALUES (?, ?)").bind("workflow-user", `${Buffer.from(iv).toString("base64url")}.${Buffer.from(encrypted).toString("base64url")}`).run();
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname === "/__fixture/stats") {
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify({uploads, captions, files: files.size})); return;
    }
    if (pathname === "/__fixture/restart" && req.method === "POST") {
      // Reproduce remote success before D1 confirmation, then destroy the Worker runtime.
      await db.prepare("UPDATE videos SET drive_file_id = NULL, drive_file_url = NULL, drive_last_attempt_at = NULL WHERE user_id = 'workflow-user'").run();
      await db.prepare("INSERT OR REPLACE INTO hosted_job_leases(user_id, owner, lease_until) VALUES ('workflow-user', 'interrupted', 0)").run();
      await runtime.dispose(); runtime = new Miniflare(options); db = await runtime.getD1Database("DB");
      res.end("restarted"); return;
    }
    const asset = path.resolve("dist/client", `.${pathname}`);
    if (asset.startsWith(path.resolve("dist/client") + path.sep)) {
      try {
        const content = readFileSync(asset);
        res.setHeader("content-type", asset.endsWith(".js") ? "application/javascript" : asset.endsWith(".css") ? "text/css" : "image/svg+xml");
        res.end(content); return;
      } catch {}
    }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const response = await runtime.dispatchFetch(`http://127.0.0.1:8787${req.url}`, {method: req.method, headers: req.headers, ...(chunks.length ? {body: Buffer.concat(chunks)} : {})});
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { console.error(error); res.writeHead(500); res.end(String(error)); }
});
server.listen(8787, "127.0.0.1", () => console.log("Release fixture Worker ready"));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { server.close(); await runtime.dispose(); process.exit(0); });
