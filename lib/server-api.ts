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

async function youtubeSapisidAuthorization(cookies: Array<[string, string]>) {
  const jar = new Map(cookies);
  const sources: Array<[string, string | undefined]> = [
    ["SAPISIDHASH", jar.get("SAPISID") || jar.get("__Secure-3PAPISID")],
    ["SAPISID1PHASH", jar.get("__Secure-1PAPISID")],
    ["SAPISID3PHASH", jar.get("__Secure-3PAPISID")],
  ];
  const timestamp = String(Math.round(Date.now() / 1000));
  const origin = "https://www.youtube.com";
  const authorization: string[] = [];
  for (const [scheme, sid] of sources) {
    if (!sid) continue;
    const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(`${timestamp} ${sid} ${origin}`));
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    authorization.push(`${scheme} ${timestamp}_${hash}`);
  }
  return authorization.join(" ");
}

export async function youtubeFetch(input: RequestInfo | URL, init: RequestInit = {}, options: { useCookies?: boolean } = {}) {
  const requestUrl = input instanceof Request ? input.url : String(input);
  const parsedUrl = new URL(requestUrl);
  const host = parsedUrl.hostname.toLowerCase();
  const headers = new Headers(init.headers);
  if (!headers.has("User-Agent")) headers.set("User-Agent", YOUTUBE_USER_AGENT);
  if ((host === "youtube.com" || host.endsWith(".youtube.com")) && options.useCookies !== false) {
    const cookies = parseYoutubeCookie(env.YOUTUBE_COOKIE);
    const cookie = cookies.map(([name, value]) => `${name}=${value}`).join("; ");
    if (cookie) headers.set("Cookie", cookie);
    if (parsedUrl.pathname.startsWith("/youtubei/")) {
      const authorization = await youtubeSapisidAuthorization(cookies);
      if (authorization) {
        headers.set("Authorization", authorization);
        headers.set("X-Origin", "https://www.youtube.com");
      }
    }
  } else if (options.useCookies === false) {
    headers.delete("Cookie");
    headers.delete("Authorization");
  }
  return fetch(input, { ...init, headers });
}

function readInitialPlayerResponse(html: string): Record<string, any> | null {
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

type PlayerDiagnostics = { playability?: string; reason?: string; attemptedClients?: string[] };

type PlayerClient = {
  name: string;
  id: string;
  version: string;
  userAgent: string;
  extra?: Record<string, unknown>;
  contextExtra?: Record<string, unknown>;
};

const PLAYER_CLIENTS: PlayerClient[] = [
  {
    name: "WEB_EMBEDDED_PLAYER",
    id: "56",
    version: "2.20260708.00.00",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Safari/605.1.15",
    contextExtra: { thirdParty: { embedUrl: "https://youtube-subtitle-manager.h-247.chatgpt.site/" } },
  },
  {
    name: "ANDROID",
    id: "3",
    version: "21.26.364",
    userAgent: "com.google.android.youtube/21.26.364 (Linux; U; Android 11) gzip",
    extra: { androidSdkVersion: 30, osName: "Android", osVersion: "11" },
  },
  {
    name: "TVHTML5",
    id: "7",
    version: "7.20260707.07.00",
    userAgent: "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/25.lts.30.1034943-gold (unlike Gecko), Unknown_TV_Unknown_0/Unknown (Unknown, Unknown)",
  },
];

function parsePlayerConfig(html: string, fallback: Record<string, any> | null) {
  return {
    apiKey: html.match(/["']INNERTUBE_API_KEY["']\s*:\s*["']([^"']+)["']/)?.[1],
    clientVersion: html.match(/["']INNERTUBE_CONTEXT_CLIENT_VERSION["']\s*:\s*["']([^"']+)["']/)?.[1]
      ?? html.match(/["']clientVersion["']\s*:\s*["']([^"']+)["']/)?.[1],
    visitorData: html.match(/["']VISITOR_DATA["']\s*:\s*["']([^"']+)["']/)?.[1]
      ?? fallback?.responseContext?.visitorData,
  };
}

function mergeCaptionTracks(target: Record<string, any>, source: Record<string, any> | null) {
  const tracks = source?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(tracks) || !tracks.length) return;
  const renderer = target.captions?.playerCaptionsTracklistRenderer ?? {};
  const existing = Array.isArray(renderer.captionTracks) ? renderer.captionTracks : [];
  const seen = new Set(existing.map((track: Record<string, any>) => `${track.languageCode || ""}|${track.vssId || ""}|${track.kind || ""}|${track.baseUrl || ""}`));
  const merged = [...existing];
  for (const track of tracks) {
    const key = `${track.languageCode || ""}|${track.vssId || ""}|${track.kind || ""}|${track.baseUrl || ""}`;
    if (!seen.has(key)) { seen.add(key); merged.push(track); }
  }
  target.captions = {
    ...(target.captions ?? {}),
    playerCaptionsTracklistRenderer: { ...renderer, ...source.captions.playerCaptionsTracklistRenderer, captionTracks: merged },
  };
}

async function requestPlayerForClient(
  apiKey: string,
  visitorData: string | undefined,
  videoId: string,
  playerPageUrl: string,
  client: PlayerClient,
  useCookies: boolean,
  clientVersion = client.version,
) {
  const clientContext: Record<string, unknown> = {
    clientName: client.name,
    clientVersion,
    userAgent: client.userAgent,
    hl: "en",
    timeZone: "UTC",
    utcOffsetMinutes: 0,
    ...(visitorData ? { visitorData } : {}),
    ...(client.extra ?? {}),
  };
  const response = await youtubeFetch(`https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}&prettyPrint=false`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": client.userAgent,
      Origin: "https://www.youtube.com",
      Referer: playerPageUrl,
      "X-YouTube-Client-Name": client.id,
      "X-YouTube-Client-Version": clientVersion,
      ...(visitorData ? { "X-Goog-Visitor-Id": visitorData } : {}),
    },
    body: JSON.stringify({
      context: { client: clientContext, ...(client.contextExtra ?? {}) },
      videoId,
      playbackContext: { contentPlaybackContext: { html5Preference: "HTML5_PREF_WANTS" } },
      contentCheckOk: true,
      racyCheckOk: true,
    }),
    signal: AbortSignal.timeout(9000),
  }, { useCookies });
  if (!response.ok) throw new Error(`YouTube player request failed (${response.status}).`);
  return await response.json() as Record<string, any>;
}

async function readWorkerPlayerResponse(
  html: string,
  videoId: string,
  playerPageUrl: string,
  fallback: Record<string, any> | null,
  diagnostics: PlayerDiagnostics,
  alternateHtml = "",
) {
  const config = parsePlayerConfig(html, fallback);
  const alternateConfig = parsePlayerConfig(alternateHtml, null);
  const apiKey = config.apiKey || alternateConfig.apiKey;
  const visitorData = config.visitorData || alternateConfig.visitorData;
  const webVersion = config.clientVersion || alternateConfig.clientVersion || "2.20260708.00.00";
  const merged = fallback ? { ...fallback } : {};
  if (!apiKey) return fallback;

  const webClient: PlayerClient = { name: "WEB", id: "1", version: webVersion, userAgent: YOUTUBE_USER_AGENT };
  const [embeddedClient, androidClient, tvClient] = PLAYER_CLIENTS;
  const run = async (client: PlayerClient, useCookies: boolean) => {
    diagnostics.attemptedClients = [...(diagnostics.attemptedClients ?? []), `${client.name} ${useCookies ? "cookie" : "public"}`];
    try {
      return await requestPlayerForClient(apiKey, useCookies ? visitorData : undefined, videoId, playerPageUrl, client, useCookies, client.version);
    } catch {
      return null;
    }
  };
  const collect = (players: Array<Record<string, any> | null>) => {
    for (const player of players) {
      if (!player) continue;
      const status = String(player.playabilityStatus?.status || "unknown");
      if (!diagnostics.playability || status === "OK") diagnostics.playability = status;
      const reason = player.playabilityStatus?.reason;
      if (status !== "OK" && typeof reason === "string") diagnostics.reason = reason.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 240);
      mergeCaptionTracks(merged, player);
      if (!merged.videoDetails && player.videoDetails) merged.videoDetails = player.videoDetails;
    }
  };
  const hasUsableTracks = () => {
    const tracks = merged.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    return Array.isArray(tracks) && tracks.some((track: Record<string, unknown>) =>
      /^en(?:[-_]|$)/i.test(String(track.languageCode || "")) || track.isTranslatable === true,
    );
  };

  // Prefer the configured session. If YouTube rejects it, request the public
  // video with client-specific headers and no account cookies.
  collect([await run(webClient, true)]);
  if (!hasUsableTracks()) {
    collect(await Promise.all([run(webClient, false), run(androidClient, false)]));
  }
  if (!hasUsableTracks()) {
    collect(await Promise.all([run(embeddedClient, false), run(tvClient, false)]));
  }
  return Object.keys(merged).length ? merged : fallback;
}

export async function getMetadata(videoId: string): Promise<{ metadata: Metadata; player: Record<string, any> | null }> {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}&hl=en`;
  const embedPageUrl = `https://www.youtube.com/embed/${videoId}?hl=en&cc_load_policy=1`;
  const [oembed, embedPage, watchPage] = await Promise.all([
    youtubeFetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(videoUrl)}`, { signal: AbortSignal.timeout(12000) }),
    youtubeFetch(embedPageUrl, { headers: { "Accept-Language": "en-US,en;q=0.9", Referer: "https://www.youtube.com/" }, signal: AbortSignal.timeout(15000) }).catch(() => null),
    youtubeFetch(videoUrl, { headers: { "Accept-Language": "en-US,en;q=0.9", Referer: "https://www.youtube.com/" }, signal: AbortSignal.timeout(15000) }).catch(() => null),
  ]);
  if (!oembed.ok) throw new Error(oembed.status === 404 ? "YouTube video was not found or is private." : `YouTube metadata request failed (${oembed.status}).`);
  const info = await oembed.json() as { title?: string; author_name?: string; author_url?: string; thumbnail_url?: string };
  const embedHtml = embedPage?.ok ? await embedPage.text() : "";
  const watchHtml = watchPage?.ok ? await watchPage.text() : "";
  const initialPlayers = [readInitialPlayerResponse(embedHtml), readInitialPlayerResponse(watchHtml)]
    .filter((candidate): candidate is Record<string, any> => candidate !== null);
  const initialPlayer = initialPlayers.find((candidate) => candidate.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length) ?? initialPlayers[0] ?? null;
  const diagnostics: PlayerDiagnostics = {};
  const primaryHtml = embedHtml || watchHtml;
  const primaryPageUrl = embedHtml ? embedPageUrl : videoUrl;
  const player = await readWorkerPlayerResponse(primaryHtml, videoId, primaryPageUrl, initialPlayer, diagnostics, embedHtml && watchHtml ? watchHtml : "");
  const playerTrackCount = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length ?? 0;
  if (!playerTrackCount) {
    if (diagnostics.playability === "LOGIN_REQUIRED") {
      const cookieCount = parseYoutubeCookie(env.YOUTUBE_COOKIE).length;
      if (!cookieCount) throw new Error("Sites found no usable YouTube cookie entries. Store the browser cookie export as JSON or a Cookie header in YOUTUBE_COOKIE.");
      const reason = diagnostics.reason ? ` YouTube response: ${diagnostics.reason}` : "";
      const clients = diagnostics.attemptedClients?.join(", ") || "WEB";
      throw new Error(`YouTube returned no captions for the ${clients} player clients. The configured session parsed (${cookieCount} cookies), but the Sites request was not accepted.${reason}`);
    }
    throw new Error(`YouTube did not return caption tracks after trying ${diagnostics.attemptedClients?.join(", ") || "the player API"}. Check video availability or the Sites runtime response.`);
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
