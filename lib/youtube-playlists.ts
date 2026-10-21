import { env } from "cloudflare:workers";
import { jobFetch as fetch } from "./job-context";
import { database } from "./server-api";
import { encryptTokens, decryptTokens, type StoredTokens, driveIsConfigured } from "./drive-service";

export const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";
const API = "https://www.googleapis.com/youtube/v3/";
const TOKEN = "https://oauth2.googleapis.com/token";
export class YouTubeError extends Error {
  constructor(public category: "AUTH_REQUIRED" | "PERMISSION" | "QUOTA" | "NETWORK" | "MISMATCH" | "CONFIGURATION" | "INVALID_REQUEST", message: string) { super(message); }
}
export function youtubeConfigured() { return driveIsConfigured(); }
export async function youtubeAccessToken(userId: string, force = false) {
  const db = database();
  const row = await db.prepare("SELECT encrypted_credentials FROM youtube_connections WHERE user_id = ?").bind(userId).first<{encrypted_credentials: string}>();
  if (!row) throw new YouTubeError("AUTH_REQUIRED", "Connect YouTube to manage your source playlists.");
  const saved = await decryptTokens(row.encrypted_credentials);
  if (!saved.scope.split(" ").includes(YOUTUBE_SCOPE)) throw new YouTubeError("AUTH_REQUIRED", "Reconnect YouTube and allow playlist management.");
  if (!force && saved.expires_at > Date.now() + 60000) return saved.access_token;
  const response = await fetch(TOKEN, {method: "POST", headers: {"Content-Type": "application/x-www-form-urlencoded"}, body: new URLSearchParams({client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, refresh_token: saved.refresh_token, grant_type: "refresh_token"}), signal: AbortSignal.timeout(15000)});
  if (!response.ok) throw new YouTubeError("AUTH_REQUIRED", "YouTube authorization expired. Reconnect YouTube.");
  const fresh = await response.json() as {access_token?: string; expires_in?: number};
  if (!fresh.access_token) throw new YouTubeError("AUTH_REQUIRED", "Reconnect YouTube to continue playlist removal.");
  const updated: StoredTokens = {...saved, access_token: fresh.access_token, expires_at: Date.now() + Number(fresh.expires_in || 3600) * 1000};
  await db.prepare("UPDATE youtube_connections SET encrypted_credentials = ?, updated_at = ? WHERE user_id = ?").bind(await encryptTokens(updated), new Date().toISOString(), userId).run();
  return updated.access_token;
}
export async function storeYouTubeCode(userId: string, code: string, redirectUri: string) {
  const response = await fetch(TOKEN, {method: "POST", headers: {"Content-Type": "application/x-www-form-urlencoded"}, body: new URLSearchParams({code, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri, grant_type: "authorization_code"}), signal: AbortSignal.timeout(15000)});
  const tokens = await response.json() as {access_token?: string; refresh_token?: string; scope?: string; expires_in?: number};
  if (!response.ok || !tokens.access_token || !tokens.scope?.split(" ").includes(YOUTUBE_SCOPE)) throw new YouTubeError("AUTH_REQUIRED", "YouTube playlist permission was not granted.");
  const previous = await database().prepare("SELECT encrypted_credentials FROM youtube_connections WHERE user_id = ?").bind(userId).first<{encrypted_credentials: string}>();
  const old = previous ? await decryptTokens(previous.encrypted_credentials) : null;
  const refresh = tokens.refresh_token || old?.refresh_token;
  if (!refresh) throw new YouTubeError("AUTH_REQUIRED", "Reconnect YouTube with offline access.");
  const encrypted = await encryptTokens({access_token: tokens.access_token, refresh_token: refresh, scope: tokens.scope, expires_at: Date.now() + Number(tokens.expires_in || 3600) * 1000});
  await database().batch([
    database().prepare("INSERT INTO youtube_connections (user_id, encrypted_credentials, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET encrypted_credentials = excluded.encrypted_credentials, updated_at = excluded.updated_at").bind(userId, encrypted, new Date().toISOString()),
    database().prepare("UPDATE playlist_cleanup_jobs SET next_attempt = 0, error = NULL WHERE user_id = ? AND state = 'PENDING'").bind(userId),
  ]);
}
export async function youtubeRequest(userId: string, path: string, parameters: Record<string, string>, method = "GET") {
  const url = new URL(path, API); url.search = new URLSearchParams(parameters).toString();
  let response: Response;
  try {
    response = await fetch(url, {method, headers: {Authorization: `Bearer ${await youtubeAccessToken(userId)}`}, signal: AbortSignal.timeout(15000)});
    if (response.status === 401) response = await fetch(url, {method, headers: {Authorization: `Bearer ${await youtubeAccessToken(userId, true)}`}, signal: AbortSignal.timeout(15000)});
  } catch (error) { if (error instanceof YouTubeError) throw error; throw new YouTubeError("NETWORK", "YouTube is unreachable. Automatic retry is pending."); }
  if (response.ok || response.status === 404) return response;
  const body = await response.json().catch(() => ({}));
  throw classifyYouTubeError(response.status, body, method);
}
export function classifyYouTubeError(status: number, body: any, method = "GET") {
  const reasons = [...(body?.error?.errors || []).map((entry: any) => entry.reason), ...(body?.error?.details || []).map((entry: any) => entry.reason)].filter((reason: unknown) => typeof reason === "string");
  const code = reasons.find((reason: string) => /^[a-zA-Z0-9_]{1,80}$/.test(reason)) || `HTTP_${status}`;
  const matches = (pattern: RegExp) => reasons.some((reason: string) => pattern.test(reason));
  if (matches(/accessNotConfigured|serviceDisabled|SERVICE_DISABLED|API_DISABLED/i)) return new YouTubeError("CONFIGURATION", "YouTube Data API v3 is disabled for the Google Cloud project used by this app. Enable it in Google Cloud Console > APIs & Services > Library, then retry. (" + code + ")");
  if (matches(/quota|dailyLimit|rateLimit/i)) return new YouTubeError("QUOTA", "YouTube API quota is exhausted. Retry later. (" + code + ")");
  if (matches(/insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i)) return new YouTubeError("AUTH_REQUIRED", "Reconnect YouTube and grant playlist management permission. (" + code + ")");
  if (matches(/youtubeSignupRequired|authenticatedUserNotChannel/i)) return new YouTubeError("AUTH_REQUIRED", "Reconnect YouTube and select the channel that owns the playlist, including the correct Brand Account channel. (" + code + ")");
  if (status === 401) return new YouTubeError("AUTH_REQUIRED", "YouTube authorization expired. Reconnect YouTube. (" + code + ")");
  if (status === 400) return new YouTubeError("INVALID_REQUEST", "YouTube rejected the playlist request. Check that this is a regular playlist URL. (" + code + ")");
  if (status === 403) return new YouTubeError("PERMISSION", (method === "DELETE" ? "YouTube refused to remove this playlist entry. " : "YouTube refused access to this playlist or channel. ") + "Reconnect using the playlist owner's YouTube channel. (" + code + ")");
  return new YouTubeError("NETWORK", "YouTube is temporarily unavailable. Automatic retry is pending. (" + code + ")");
}
export async function readManagedPlaylist(userId: string, playlistId: string) {
  if (!/^[\w-]{2,150}$/.test(playlistId)) throw new Error("Invalid playlist ID.");
  const [playlistResponse, channelResponse] = await Promise.all([
    youtubeRequest(userId, "playlists", {part: "snippet", id: playlistId}),
    youtubeRequest(userId, "channels", {part: "id,snippet", mine: "true", maxResults: "50"}),
  ]);
  const playlist = (await playlistResponse.json() as {items?: Array<{snippet: {title: string; channelId: string}}>}).items?.[0];
  const channels = (await channelResponse.json() as {items?: Array<{id: string; snippet?: {title?: string}}>}).items || [];
  if (!playlist) throw new YouTubeError("INVALID_REQUEST", "The playlist was not found or is unavailable to the connected YouTube channel.");
  if (!channels.some(c => c.id === playlist.snippet.channelId)) throw new YouTubeError("PERMISSION", `The connected YouTube channel (${channels.map(c => c.snippet?.title || c.id).join(", ") || "no channel"}) does not own this playlist. Reconnect YouTube and select the playlist owner's channel or Brand Account.`);
  const videos: Array<{video_id: string; playlist_item_id: string; title: string; channel_title: string | null; channel_url: string | null; thumbnail_url: string | null; duration: null}> = [];
  const seen = new Set<string>(); let token = "";
  do {
    if (seen.has(token)) throw new Error("YouTube returned an incomplete playlist. Retry before importing.");
    seen.add(token);
    const response = await youtubeRequest(userId, "playlistItems", {part: "snippet,contentDetails", playlistId, maxResults: "50", ...(token ? {pageToken: token} : {})});
    if (!response.ok) throw new Error("This playlist is unavailable.");
    const page = await response.json() as {items?: Array<any>; nextPageToken?: string};
    for (const item of page.items || []) {
      const snippet = item.snippet; const videoId = item.contentDetails?.videoId || snippet?.resourceId?.videoId;
      if (!item.id || !/^[\w-]{11}$/.test(videoId || "") || ["Private video", "Deleted video"].includes(snippet?.title)) continue;
      videos.push({video_id: videoId, playlist_item_id: item.id, title: snippet.title || videoId, channel_title: snippet.videoOwnerChannelTitle || null, channel_url: snippet.videoOwnerChannelId ? `https://www.youtube.com/channel/${snippet.videoOwnerChannelId}` : null, thumbnail_url: snippet.thumbnails?.high?.url || null, duration: null});
    }
    token = page.nextPageToken || "";
  } while (token);
  return {title: playlist.snippet.title, videos};
}
export async function enqueuePlaylistRemoval(userId: string, videoId: string, items: unknown) {
  if (!Array.isArray(items)) return;
  const db = database();
  const statements = [];
  for (const item of items) {
    if (!item || typeof item.playlist_id !== "string" || typeof item.playlist_item_id !== "string" || !/^[\w-]{2,150}$/.test(item.playlist_id) || item.playlist_item_id.length < 1 || item.playlist_item_id.length > 512) continue;
    statements.push(db.prepare(`INSERT INTO playlist_cleanup_jobs (user_id, video_id, playlist_id, playlist_item_id, updated_at)
      SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM videos WHERE user_id = ? AND video_id = ?)
      ON CONFLICT(user_id, playlist_item_id) DO UPDATE SET state = CASE WHEN playlist_cleanup_jobs.state = 'CANCELLED' THEN 'PENDING' ELSE playlist_cleanup_jobs.state END`)
      .bind(userId, videoId, item.playlist_id, item.playlist_item_id, new Date().toISOString(), userId, videoId));
  }
  if (statements.length) await db.batch(statements);
}
export async function processOnePlaylistRemoval(userId: string) {
  const db = database(); const now = Date.now();
  const job = await db.prepare(`SELECT j.* FROM playlist_cleanup_jobs j JOIN videos v ON v.user_id = j.user_id AND v.video_id = j.video_id
    WHERE j.user_id = ? AND j.state = 'PENDING' AND j.next_attempt <= ? AND j.lease_until <= ?
    AND v.status = 'COMPLETED' AND v.subtitle_text IS NOT NULL AND length(trim(v.subtitle_text)) > 0 AND v.processing_paused = 0
    ORDER BY j.next_attempt, j.id LIMIT 1`).bind(userId, now, now).first<{id: number; video_id: string; playlist_id: string; playlist_item_id: string; attempts: number}>();
  if (!job) return;
  const claimed = await db.prepare("UPDATE playlist_cleanup_jobs SET lease_until = ?, attempts = attempts + 1 WHERE id = ? AND user_id = ? AND state = 'PENDING' AND lease_until <= ?").bind(now + 90000, job.id, userId, now).run();
  if (!claimed.meta.changes) return;
  try {
    // Verify the exact membership, never delete the video resource itself.
    const current = await youtubeRequest(userId, "playlistItems", {part: "snippet,contentDetails", id: job.playlist_item_id});
    if (current.ok) {
      const item = (await current.json() as {items?: Array<any>}).items?.[0];
      if (item) {
        if (item.snippet?.playlistId !== job.playlist_id || (item.contentDetails?.videoId || item.snippet?.resourceId?.videoId) !== job.video_id) throw new YouTubeError("MISMATCH", "Playlist item no longer matches the imported video. No removal was performed.");
        const stillSaved = await db.prepare(`SELECT 1 AS ready FROM videos v JOIN playlist_cleanup_jobs j ON j.user_id = v.user_id AND j.video_id = v.video_id
          WHERE j.id = ? AND j.user_id = ? AND j.state = 'PENDING' AND v.status = 'COMPLETED' AND v.subtitle_text IS NOT NULL AND length(trim(v.subtitle_text)) > 0 AND v.processing_paused = 0 AND EXISTS (SELECT 1 FROM youtube_connections WHERE user_id = j.user_id)`).bind(job.id, userId).first();
        if (!stillSaved) { await db.prepare("UPDATE playlist_cleanup_jobs SET lease_until = 0 WHERE id = ? AND user_id = ?").bind(job.id, userId).run(); return; }
        const removed = await youtubeRequest(userId, "playlistItems", {id: job.playlist_item_id}, "DELETE");
        if (removed.status !== 204 && removed.status !== 404) throw new YouTubeError("NETWORK", "YouTube did not confirm removal.");
      }
    }
    await db.prepare("UPDATE playlist_cleanup_jobs SET state = 'REMOVED', error = NULL, lease_until = 0, updated_at = ? WHERE id = ? AND user_id = ?").bind(new Date().toISOString(), job.id, userId).run();
  } catch (error) {
    const reason = error instanceof YouTubeError ? error : new YouTubeError("NETWORK", "Playlist removal failed. Automatic retry is pending.");
    const permanent = ["MISMATCH", "PERMISSION", "CONFIGURATION", "INVALID_REQUEST"].includes(reason.category);
    const delay = reason.category === "QUOTA" ? 6 * 3600000 : reason.category === "AUTH_REQUIRED" ? 300000 : Math.min(3600000, 5000 * 2 ** Math.min(job.attempts, 10));
    await db.prepare("UPDATE playlist_cleanup_jobs SET state = ?, next_attempt = ?, lease_until = 0, error = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(permanent ? "FAILED" : "PENDING", now + delay, `${reason.category}: ${reason.message}`, new Date().toISOString(), job.id, userId).run();
  }
}
export async function youtubeStatus(userId: string) {
  const db = database();
  const connection = await db.prepare("SELECT 1 AS connected FROM youtube_connections WHERE user_id = ?").bind(userId).first();
  let connected = !!connection; let connectionError: string | null = null;
  if (connected) { try {
    const response = await youtubeRequest(userId, "channels", {part:"id",mine:"true",maxResults:"1"});
    const payload = await response.json() as {items?: Array<{id:string}>};
    if (!payload.items?.length) throw new YouTubeError("AUTH_REQUIRED", "No YouTube channel is selected. Reconnect and select the playlist owner's channel.");
  } catch (error) { connected = false; connectionError = error instanceof YouTubeError ? error.message : "Could not verify YouTube connection. Retry later."; } }
  const jobs = await db.prepare("SELECT video_id, playlist_id, state, error FROM playlist_cleanup_jobs WHERE user_id = ? ORDER BY updated_at DESC LIMIT 30").bind(userId).all();
  const totals = await db.prepare("SELECT state, count(*) AS total FROM playlist_cleanup_jobs WHERE user_id = ? GROUP BY state").bind(userId).all<{state:string;total:number}>();
  const count = (state: string) => Number(totals.results?.find(row => row.state === state)?.total || 0);
  return {is_configured: youtubeConfigured(), is_connected: connected, connection_error: connectionError, jobs: jobs.results || [], pending_count: count("PENDING"), removed_count: count("REMOVED"), failed_count: count("FAILED")};
}
