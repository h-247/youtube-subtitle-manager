import { env } from "cloudflare:workers";
import { jobFetch as fetch } from "./job-context";
import { database } from "./server-api";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
const DRIVE_FOLDER_NAME = "YouTube Subtitles";

export type StoredTokens = { access_token: string; refresh_token: string; expires_at: number; scope: string };

function encode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function configured() {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_TOKEN_ENCRYPTION_KEY);
}

async function encryptionKey() {
  const raw = env.GOOGLE_TOKEN_ENCRYPTION_KEY ? decode(env.GOOGLE_TOKEN_ENCRYPTION_KEY) : new Uint8Array();
  if (raw.byteLength !== 32) throw new Error("Google Drive token encryption is not configured.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptTokens(tokens: StoredTokens) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), new TextEncoder().encode(JSON.stringify(tokens)));
  return `${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
}

export async function decryptTokens(value: string): Promise<StoredTokens> {
  const [iv, ciphertext] = value.split(".");
  if (!iv || !ciphertext) throw new Error("Stored Google Drive credentials are invalid.");
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(iv) }, await encryptionKey(), decode(ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext)) as StoredTokens;
}

export function driveIsConfigured() { return configured(); }

export function driveRedirectUri(requestUrl: string) {
  return `${new URL(requestUrl).origin}/api/drive/callback`;
}

export async function storeAuthorizationCode(userId: string, code: string, redirectUri: string) {
  if (!configured()) throw new Error("Google Drive OAuth is not configured.");
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
  if (!response.ok || !result.access_token) throw new Error("Google authorization could not be completed. Check the OAuth client and redirect URI.");

  const db = database();
  const previous = await db.prepare("SELECT encrypted_credentials FROM drive_connections WHERE user_id = ?")
    .bind(userId).first<{ encrypted_credentials: string }>();
  const oldTokens = previous ? await decryptTokens(previous.encrypted_credentials) : null;
  if (!result.refresh_token && !oldTokens?.refresh_token) throw new Error("Google did not issue a refresh token. Disconnect Drive in Google account settings and reconnect with consent.");
  const encrypted = await encryptTokens({
    access_token: result.access_token,
    refresh_token: result.refresh_token || oldTokens!.refresh_token,
    expires_at: Date.now() + Number(result.expires_in || 3600) * 1000,
    scope: result.scope || DRIVE_SCOPE,
  });
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO drive_connections (user_id, encrypted_credentials, created_at, updated_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET encrypted_credentials = excluded.encrypted_credentials, updated_at = excluded.updated_at`)
    .bind(userId, encrypted, now, now).run();
  await db.prepare(`UPDATE videos SET error_category = NULL, error_message = NULL,
    progress_message = 'Subtitles saved; Google Drive upload will retry', drive_last_attempt_at = NULL, updated_at = ?
    WHERE user_id = ? AND error_category = 'DRIVE_UPLOAD' AND drive_file_id IS NULL`)
    .bind(now, userId).run();
}

async function accessToken(userId: string, forceRefresh = false): Promise<string> {
  const db = database();
  const row = await db.prepare("SELECT encrypted_credentials FROM drive_connections WHERE user_id = ?")
    .bind(userId).first<{ encrypted_credentials: string }>();
  if (!row) throw new Error("Google Drive is not connected.");
  const tokens = await decryptTokens(row.encrypted_credentials);
  if (!forceRefresh && tokens.expires_at > Date.now() + 60_000) return tokens.access_token;
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, refresh_token: tokens.refresh_token, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json() as { access_token?: string; expires_in?: number };
  if (!response.ok || !result.access_token) throw new Error("Google Drive access expired. Reconnect the Google account.");
  const updated = { ...tokens, access_token: result.access_token, expires_at: Date.now() + Number(result.expires_in || 3600) * 1000 };
  await db.prepare("UPDATE drive_connections SET encrypted_credentials = ?, updated_at = ? WHERE user_id = ?")
    .bind(await encryptTokens(updated), new Date().toISOString(), userId).run();
  return updated.access_token;
}

async function googleJson(url: string, token: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` }, signal: init?.signal ?? AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Google Drive request failed (HTTP ${response.status}).`);
  return response.json() as Promise<Record<string, unknown>>;
}

async function getOrCreateFolder(token: string) {
  const query = `mimeType = 'application/vnd.google-apps.folder' and name = '${DRIVE_FOLDER_NAME}' and trashed = false`;
  try {
    const list = await googleJson(`${DRIVE_API}?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id)`, token) as { files?: Array<{ id?: string }> };
    if (list.files?.[0]?.id) return list.files[0].id;
    const folder = await googleJson(`${DRIVE_API}?fields=id`, token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }) });
    return typeof folder.id === "string" ? folder.id : null;
  } catch { return null; }
}

async function uploadWithToken(title: string, content: string, token: string, uploadId: string) {
  const existing = await fetch(`${DRIVE_API}/${encodeURIComponent(uploadId)}?fields=id,webViewLink`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  if (existing.ok) return existing.json() as Promise<{ id?: string; webViewLink?: string }>;
  if (existing.status !== 404) throw new Error(`Google Drive request failed (HTTP ${existing.status}).`);
  const folderId = await getOrCreateFolder(token);
  const boundary = `sites_drive_${crypto.randomUUID().replace(/-/g, "")}`;
  const safeTitle = title.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 120) || "subtitle";
  const metadata = { id: uploadId, name: `${safeTitle}.srt`, mimeType: "text/plain", ...(folderId ? { parents: [folderId] } : {}) };
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`;
  try {
    return await googleJson(`${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id,webViewLink`, token, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body, signal: AbortSignal.timeout(30000) }) as { id?: string; webViewLink?: string };
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("HTTP 409")) throw error;
    return googleJson(`${DRIVE_API}/${encodeURIComponent(uploadId)}?fields=id,webViewLink`, token) as Promise<{ id?: string; webViewLink?: string }>;
  }
}

export async function uploadSubtitle(userId: string, title: string, content: string, videoId: number) {
  const first = await accessToken(userId);
  const db = database();
  let saved = await db.prepare("SELECT drive_upload_id FROM videos WHERE id = ? AND user_id = ?").bind(videoId, userId).first<{ drive_upload_id: string | null }>();
  if (!saved) throw new Error("Video no longer exists.");
  if (!saved.drive_upload_id) {
    const generated = await googleJson(`${DRIVE_API}/generateIds?count=1&space=drive&type=files`, first) as { ids?: string[] };
    if (!generated.ids?.[0]) throw new Error("Google Drive did not reserve an upload ID.");
    await db.prepare("UPDATE videos SET drive_upload_id = ? WHERE id = ? AND user_id = ? AND drive_upload_id IS NULL").bind(generated.ids[0], videoId, userId).run();
    saved = await db.prepare("SELECT drive_upload_id FROM videos WHERE id = ? AND user_id = ?").bind(videoId, userId).first<{ drive_upload_id: string | null }>();
  }
  if (!saved?.drive_upload_id) throw new Error("Upload identity could not be saved.");
  const uploadId = saved.drive_upload_id;
  try { return await uploadWithToken(title, content, first, uploadId); }
  catch (error) {
    if (!(error instanceof Error) || !error.message.includes("HTTP 401")) throw error;
    return uploadWithToken(title, content, await accessToken(userId, true), uploadId);
  }
}

export async function disconnectDrive(userId: string) {
  await database().prepare("DELETE FROM drive_connections WHERE user_id = ?").bind(userId).run();
}

export async function syncOnePendingSubtitle(userId: string) {
  if (!configured()) return null;
  const db = database();
  const connection = await db.prepare("SELECT 1 AS connected FROM drive_connections WHERE user_id = ?")
    .bind(userId).first<{ connected: number }>();
  if (!connection) return null;
  const row = await db.prepare(`SELECT id, video_id, title, subtitle_text, drive_retry_count, drive_last_attempt_at
    FROM videos WHERE user_id = ? AND status = 'COMPLETED' AND processing_paused = 0 AND drive_file_id IS NULL AND subtitle_text IS NOT NULL
    ORDER BY coalesce(drive_last_attempt_at, '') ASC, created_at ASC LIMIT 1`).bind(userId).first<{
      id: number; video_id: string; title: string; subtitle_text: string; drive_retry_count: number; drive_last_attempt_at: string | null;
    }>();
  if (!row) return null;

  const retryCount = Number(row.drive_retry_count || 0);
  const last = row.drive_last_attempt_at ? Date.parse(row.drive_last_attempt_at) : 0;
  const delayMs = retryCount === 0 ? 0 : Math.min(60_000, 2_000 * 2 ** Math.min(retryCount - 1, 5));
  if (Date.now() - last < delayMs) return null;
  const now = new Date().toISOString();
  const claim = await db.prepare(`UPDATE videos SET drive_last_attempt_at = ?, drive_retry_count = drive_retry_count + 1, updated_at = ?
    WHERE id = ? AND user_id = ? AND status = 'COMPLETED' AND processing_paused = 0 AND drive_file_id IS NULL
    AND drive_retry_count = ? AND (drive_last_attempt_at IS NULL OR drive_last_attempt_at <= ?)`).bind(now, now, row.id, userId, retryCount, new Date(Date.now() - delayMs).toISOString()).run();
  if (!claim.meta.changes) return null;

  const attempt = retryCount + 1;
  try {
    const uploaded = await uploadSubtitle(userId, row.title, row.subtitle_text, row.id);
    if (!uploaded.id) throw new Error("Google Drive did not return a file ID.");
    const driveFileUrl = uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`;
    await db.prepare(`UPDATE videos SET drive_file_id = ?, drive_file_url = ?, progress_message = 'Subtitles ready and synced to Google Drive', error_message = NULL, error_category = NULL, updated_at = ?
      WHERE id = ? AND user_id = ? AND drive_file_id IS NULL`).bind(
      uploaded.id,
      driveFileUrl,
      new Date().toISOString(), row.id, userId,
    ).run();
    return { video_id: row.video_id, drive_file_id: uploaded.id, drive_file_url: driveFileUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Drive upload failed.";
    await db.prepare("UPDATE videos SET error_category = 'DRIVE_UPLOAD', error_message = 'Drive upload failed; downloaded subtitles are saved', progress_message = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .bind(`Drive upload retry #${attempt}: ${message}`, new Date().toISOString(), row.id, userId).run();
    return null;
  }
}
