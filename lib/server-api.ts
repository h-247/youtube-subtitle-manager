import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../app/chatgpt-auth";

export type LibraryVideo = {
  id: number;
  user_id: string;
  video_id: string;
  youtube_url: string;
  title: string;
  channel_title: string | null;
  channel_url: string | null;
  duration: number | null;
  thumbnail_url: string | null;
  status: string;
  watch_status: string;
  channel_tags: string | null;
  subtitle_type: string;
  subtitle_language: string | null;
  drive_file_id: string | null;
  drive_file_url: string | null;
  chatgpt_link: string | null;
  retry_count: number;
  progress_message: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  subtitle_text?: string | null;
  last_attempt_at?: string | null;
};

export async function currentSiteUser() {
  return getChatGPTUser();
}

export function database() {
  if (!env.DB) throw new Error("Sites D1 database binding is not available.");
  return env.DB;
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function errorResponse(message: string, status = 400) {
  return json({ detail: message }, status);
}

export function videoFromRow(row: Record<string, unknown>): LibraryVideo {
  return {
    id: Number(row.id),
    user_id: String(row.user_id),
    video_id: String(row.video_id),
    youtube_url: String(row.youtube_url),
    title: String(row.title),
    channel_title: row.channel_title == null ? null : String(row.channel_title),
    channel_url: row.channel_url == null ? null : String(row.channel_url),
    duration: row.duration == null ? null : Number(row.duration),
    thumbnail_url: row.thumbnail_url == null ? null : String(row.thumbnail_url),
    status: String(row.status),
    watch_status: String(row.watch_status),
    channel_tags: row.channel_tags == null ? null : String(row.channel_tags),
    subtitle_type: String(row.subtitle_type),
    subtitle_language: row.subtitle_language == null ? null : String(row.subtitle_language),
    drive_file_id: row.drive_file_id == null ? null : String(row.drive_file_id),
    drive_file_url: row.drive_file_url == null ? null : String(row.drive_file_url),
    chatgpt_link: row.chatgpt_link == null ? null : String(row.chatgpt_link),
    retry_count: Number(row.retry_count || 0),
    progress_message: row.progress_message == null ? null : String(row.progress_message),
    error_message: row.error_message == null ? null : String(row.error_message),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    subtitle_text: row.subtitle_text == null ? null : String(row.subtitle_text),
    last_attempt_at: row.last_attempt_at == null ? null : String(row.last_attempt_at),
  };
}

export function extractVideoId(input: string): string | null {
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let id: string | null = null;
    if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] ?? null;
    else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      id = url.searchParams.get("v") ?? url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?]+)/)?.[1] ?? null;
    }
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function extractPlaylistId(input: string): string | null {
  try {
    const url = new URL(input);
    const id = url.searchParams.get("list");
    return id && /^[\w-]{10,80}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

type Metadata = { title: string; channelTitle: string | null; channelUrl: string | null; thumbnailUrl: string; duration: number | null };

const YOUTUBE_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function parseYoutubeCookie(value: string | undefined) {
  const raw = value?.trim();
  if (!raw) return [] as Array<[string, string]>;

  const cookies = new Map<string, string>();
  const add = (name: unknown, cookieValue: unknown, domain?: unknown) => {
    if (typeof name !== "string" || typeof cookieValue !== "string") return;
    if (typeof domain === "string") {
      const normalizedDomain = domain.replace(/^\./, "").toLowerCase();
      if (normalizedDomain !== "youtube.com" && !normalizedDomain.endsWith(".youtube.com")) return;
    }
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z_-]+$/.test(name) || /[\u0000-\u001f\u007f;]/.test(cookieValue)) return;
    cookies.set(name, cookieValue);
  };

  if (raw.startsWith("[") || raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      const entries = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && Array.isArray((parsed as { cookies?: unknown }).cookies)
          ? (parsed as { cookies: unknown[] }).cookies
          : [];
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        const cookie = entry as { name?: unknown; value?: unknown; domain?: unknown };
        add(cookie.name, cookie.value, cookie.domain);
      }
      return [...cookies.entries()];
    } catch {
      return [];
    }
  }

  for (const line of raw.split(/[\r\n]+/)) {
    const columns = line.split("\t");
    if (columns.length >= 7) {
      const domain = columns[0].replace(/^#HttpOnly_/, "");
      add(columns[5], columns.slice(6).join("\t"), domain);
      continue;
    }
    for (const part of line.split(";")) {
      const separator = part.indexOf("=");
      if (separator > 0) add(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
    }
  }
  return [...cookies.entries()];
}

export function youtubeFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const requestUrl = input instanceof Request ? input.url : String(input);
  const host = new URL(requestUrl).hostname.toLowerCase();
  const headers = new Headers(init.headers);
  headers.set("User-Agent", YOUTUBE_USER_AGENT);
  if (host === "youtube.com" || host.endsWith(".youtube.com")) {
    const cookie = parseYoutubeCookie(env.YOUTUBE_COOKIE).map(([name, value]) => `${name}=${value}`).join("; ");
    if (cookie) headers.set("Cookie", cookie);
  }
  return fetch(input, { ...init, headers });
}

async function readInitialPlayerResponse(html: string) {
  const marker = /ytInitialPlayerResponse\s*=\s*/.exec(html);
  if (!marker) return null;
  const jsonStart = marker.index + marker[0].length;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = jsonStart; i < html.length; i++) {
    const char = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) {
      try { return JSON.parse(html.slice(jsonStart, i + 1)) as Record<string, any>; }
      catch { return null; }
    }
  }
  return null;
}

type PlayerDiagnostics = { playability?: string };

async function readWorkerPlayerResponse(html: string, videoId: string, playerPageUrl: string, fallback: Record<string, any> | null, diagnostics: PlayerDiagnostics) {
  const apiKey = html.match(/["']INNERTUBE_API_KEY["']\s*:\s*["']([^"']+)["']/)?.[1];
  const visitorData = html.match(/["']VISITOR_DATA["']\s*:\s*["']([^"']+)["']/)?.[1]
    ?? fallback?.responseContext?.visitorData;
  if (!apiKey || !visitorData) return fallback;

  const client = {
    clientName: "VISIONOS",
    clientVersion: "1.02",
    deviceMake: "Apple",
    deviceModel: "RealityDevice17,1",
    userAgent: YOUTUBE_USER_AGENT,
    osName: "visionOS",
    osVersion: "26.5.23O471",
    hl: "en",
    timeZone: "UTC",
    utcOffsetMinutes: 0,
    visitorData,
  };
  try {
    const response = await youtubeFetch(`https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}&prettyPrint=false`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": YOUTUBE_USER_AGENT,
        Origin: "https://www.youtube.com",
        Referer: playerPageUrl,
        "X-YouTube-Client-Name": "101",
        "X-YouTube-Client-Version": client.clientVersion,
        "X-Goog-Visitor-Id": visitorData,
      },
      body: JSON.stringify({
        context: { client },
        videoId,
        playbackContext: { contentPlaybackContext: { html5Preference: "HTML5_PREF_WANTS" } },
        contentCheckOk: true,
        racyCheckOk: true,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return fallback;
    const player = await response.json() as Record<string, any>;
    diagnostics.playability = String(player.playabilityStatus?.status || "unknown");
    if (player.playabilityStatus?.status !== "OK") return fallback;
    const playerTracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    const fallbackTracks = fallback?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    const playerHasTranslations = Array.isArray(playerTracks) && playerTracks.some((track: Record<string, unknown>) => track.isTranslatable === true);
    const fallbackHasTranslations = Array.isArray(fallbackTracks) && fallbackTracks.some((track: Record<string, unknown>) => track.isTranslatable === true);
    if ((!Array.isArray(playerTracks) || playerTracks.length === 0 || (!playerHasTranslations && fallbackHasTranslations)) && Array.isArray(fallbackTracks) && fallbackTracks.length > 0) {
      player.captions = fallback?.captions;
    }
    return player;
  } catch {
    return fallback;
  }
}

export async function getMetadata(videoId: string): Promise<{ metadata: Metadata; player: Record<string, any> | null }> {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}&hl=en`;
  const playerPageUrl = `https://www.youtube.com/embed/${videoId}?hl=en&cc_load_policy=1`;
  const [oembed, page] = await Promise.all([
    youtubeFetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(videoUrl)}`, { signal: AbortSignal.timeout(12000) }),
    youtubeFetch(playerPageUrl, { headers: { "Accept-Language": "en-US,en;q=0.9", Referer: "https://www.youtube.com/" }, signal: AbortSignal.timeout(15000) }),
  ]);
  if (!oembed.ok) throw new Error(oembed.status === 404 ? "YouTube video was not found or is private." : `YouTube metadata request failed (${oembed.status}).`);
  const info = await oembed.json() as { title?: string; author_name?: string; author_url?: string; thumbnail_url?: string };
  const html = page.ok ? await page.text() : "";
  const initialPlayer = await readInitialPlayerResponse(html);
  const diagnostics: PlayerDiagnostics = {};
  const player = await readWorkerPlayerResponse(html, videoId, playerPageUrl, initialPlayer, diagnostics);
  const playerTrackCount = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length ?? 0;
  if (!playerTrackCount) {
    if (diagnostics.playability === "LOGIN_REQUIRED") {
      const cookieCount = parseYoutubeCookie(env.YOUTUBE_COOKIE).length;
      if (!cookieCount) throw new Error("Sites found no usable YouTube cookie entries. Store the browser cookie export as JSON or a Cookie header in YOUTUBE_COOKIE.");
      throw new Error(`YouTube rejected the configured sign-in session from Sites after ${cookieCount} cookie entries were parsed. The Sites runtime may not be accepted by YouTube for this account.`);
    }
    throw new Error("YouTube did not return caption tracks. Check the cookie session or use another backend runtime.");
  }
  const duration = Number(player?.videoDetails?.lengthSeconds);
  return {
    metadata: {
      title: String(info.title || player?.videoDetails?.title || videoId),
      channelTitle: info.author_name ?? player?.videoDetails?.author ?? null,
      channelUrl: info.author_url ?? null,
      thumbnailUrl: info.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      duration: Number.isFinite(duration) && duration > 0 ? duration : null,
    },
    player,
  };
}

function xmlDecode(value: string) {
  return value.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

function timestamp(milliseconds: number) {
  const total = Math.max(0, Math.floor(milliseconds));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1_000);
  const ms = total % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function toSrt(content: string) {
  try {
    const data = JSON.parse(content) as { events?: Array<{ tStartMs?: number; dDurationMs?: number; segs?: Array<{ utf8?: string }> }> };
    const events = (data.events ?? []).flatMap((event) => {
      const text = (event.segs ?? []).map((segment) => segment.utf8 ?? "").join("").trim();
      if (!text || !Number.isFinite(event.tStartMs)) return [];
      const start = Number(event.tStartMs);
      const end = start + Number(event.dDurationMs || 2500);
      return [{ start, end, text }];
    });
    if (events.length) return events.map((event, index) => `${index + 1}\n${timestamp(event.start)} --> ${timestamp(event.end)}\n${event.text}`).join("\n\n");
  } catch { /* YouTube can return XML or VTT instead of JSON3. */ }

  const xmlEvents = [...content.matchAll(/<text\b[^>]*start="([\d.]+)"[^>]*(?:dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g)];
  if (xmlEvents.length) return xmlEvents.map((match, index) => {
    const start = Number(match[1]) * 1000;
    const end = start + Number(match[2] || 2.5) * 1000;
    return `${index + 1}\n${timestamp(start)} --> ${timestamp(end)}\n${xmlDecode(match[3])}`;
  }).join("\n\n");

  const vttEvents = [...content.matchAll(/(\d{2}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}\.\d{3})[^\n]*\n([\s\S]*?)(?=\n\s*\n|$)/g)];
  return vttEvents.map((match, index) => {
    const convert = (time: string) => `${time.slice(0, 12)},${time.slice(12)}`;
    return `${index + 1}\n${convert(match[1])} --> ${convert(match[2])}\n${xmlDecode(match[3])}`;
  }).join("\n\n");
}

export async function downloadEnglishCaptions(player: Record<string, any> | null) {
  const tracks: Array<{ baseUrl?: string; languageCode?: string; kind?: string; isTranslatable?: boolean; translatedFrom?: string; translated?: boolean }> =
    player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const english = tracks.filter((track) => /^en(?:[-_]|$)/i.test(track.languageCode || ""));
  const translated = tracks
    .filter((track) => track.isTranslatable && !/^en(?:[-_]|$)/i.test(track.languageCode || ""))
    .map((track) => ({ ...track, translatedFrom: track.languageCode, translated: true, languageCode: "en" }));
  const ordered = [
    ...english.filter((track) => track.kind !== "asr"),
    ...english.filter((track) => track.kind === "asr"),
    ...translated.filter((track) => track.kind !== "asr"),
    ...translated.filter((track) => track.kind === "asr"),
  ];
  if (!ordered.length) {
    const trackSummary = tracks.map((track) => `${track.languageCode || "unknown"}${track.kind === "asr" ? " (auto)" : ""}${track.isTranslatable ? " (translatable)" : ""}`).join(", ") || "none";
    throw new Error(`No English subtitle track is available for this video. YouTube tracks: ${trackSummary}.`);
  }

  let lastError = "YouTube returned an empty subtitle track.";
  for (const track of ordered) {
    if (!track.baseUrl) continue;
    for (const format of ["json3", "srv3", "vtt"]) {
      try {
        const url = new URL(track.baseUrl);
        url.searchParams.set("key", "yt8");
        url.searchParams.set("lang", track.translatedFrom || track.languageCode || "en");
        if (track.translated) url.searchParams.set("tlang", "en");
        url.searchParams.set("fmt", format);
        const response = await youtubeFetch(url, { headers: { Referer: "https://www.youtube.com/" }, signal: AbortSignal.timeout(12000) });
        if (response.status === 429) throw new Error("YouTube rate limited caption download (HTTP 429).");
        if (!response.ok) throw new Error(`YouTube caption request failed (${response.status}).`);
        const content = await response.text();
        const subtitle = toSrt(content);
        if (subtitle) return { subtitle, type: track.translated || track.kind === "asr" ? "AUTO" : "MANUAL", language: "en" };
        lastError = "YouTube returned an empty subtitle track.";
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Subtitle download failed.";
        if (lastError.includes("429")) throw new Error(lastError);
      }
    }
  }
  throw new Error(lastError);
}

export async function retryVideo(videoId: number, userId: string) {
  const db = database();
  const existing = await db.prepare("SELECT * FROM videos WHERE id = ? AND user_id = ? AND status = 'PROCESSING'").bind(videoId, userId).first<LibraryVideo>();
  if (!existing) return;
  const retryCount = Number(existing.retry_count || 0);
  const last = existing.last_attempt_at ? Date.parse(existing.last_attempt_at) : 0;
  const delayMs = retryCount === 0 ? 0 : Math.min(60_000, 2_000 * 2 ** Math.min(retryCount - 1, 5));
  if (Date.now() - last < delayMs) return;
  const now = new Date().toISOString();
  const claim = await db.prepare(
    "UPDATE videos SET last_attempt_at = ?, retry_count = retry_count + 1, progress_message = ?, error_message = NULL, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'PROCESSING' AND (last_attempt_at IS NULL OR last_attempt_at <= ?)"
  ).bind(now, retryCount ? `Retrying subtitle download (attempt ${retryCount + 1})…` : "Reading video details and finding English captions…", now, videoId, userId, new Date(Date.now() - delayMs).toISOString()).run();
  if (!claim.meta.changes) return;

  const attempt = retryCount + 1;
  try {
    const { metadata, player } = await getMetadata(existing.video_id);
    const result = await downloadEnglishCaptions(player);
    const finished = new Date().toISOString();
    await db.prepare(
      "UPDATE videos SET status = 'COMPLETED', subtitle_type = ?, subtitle_language = ?, subtitle_text = ?, channel_title = COALESCE(?, channel_title), channel_url = COALESCE(?, channel_url), duration = COALESCE(?, duration), thumbnail_url = COALESCE(?, thumbnail_url), progress_message = 'Subtitles ready', error_message = NULL, updated_at = ? WHERE id = ? AND user_id = ?"
    ).bind(result.type, result.language, result.subtitle, metadata.channelTitle, metadata.channelUrl, metadata.duration, metadata.thumbnailUrl, finished, videoId, userId).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Subtitle download failed.";
    const failedAt = new Date().toISOString();
    await db.prepare(
      "UPDATE videos SET progress_message = ?, error_message = ?, updated_at = ? WHERE id = ? AND user_id = ?"
    ).bind(`Retry #${attempt}: ${message}`, message, failedAt, videoId, userId).run();
  }
}
