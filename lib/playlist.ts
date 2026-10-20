import { readEmbeddedJson, youtubeFetch } from "./server-api";
type PlaylistVideo = { video_id: string; title: string; channel_title: string | null; channel_url: string | null; thumbnail_url: string | null; duration: number | null };
const text = (value: any): string => value?.simpleText || value?.runs?.map((r: any) => r.text || "").join("") || "";
function find(node: any, key: string): any {
  if (!node || typeof node !== "object") return null;
  if (node[key]) return node[key];
  for (const child of Object.values(node)) { const result = find(child, key); if (result) return result; }
  return null;
}
export async function readPlaylist(id: string) {
  const response = await youtubeFetch(`https://www.youtube.com/playlist?list=${encodeURIComponent(id)}&hl=en`, {signal: AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error("Could not read this public YouTube playlist.");
  const html = await response.text();
  const data = readEmbeddedJson(html, /ytInitialData\s*=\s*/);
  const title = data?.metadata?.playlistMetadataRenderer?.title || text(data?.header?.playlistHeaderRenderer?.title);
  if (!title || !data) throw new Error("Could not read the playlist name. Check that the playlist is public.");
  const videos: PlaylistVideo[] = []; const seen = new Set<string>(); const tokens = new Set<string>();
  const context = readEmbeddedJson(html, /ytcfg\.set\(\s*/)?.INNERTUBE_CONTEXT || {client: {clientName: "WEB", clientVersion: html.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/)?.[1] || "2.20261019.01.00"}};
  const first = find(data, "playlistVideoListRenderer");
  if (!first) throw new Error("No accessible videos were found in this playlist.");
  let page: any = first;
  for (let count = 0; count < 100; count++) {
    let next: string | null = null;
    const visit = (node: any) => {
      if (!node || typeof node !== "object") return;
      if (node.playlistVideoRenderer) {
        const v = node.playlistVideoRenderer;
        if (/^[\w-]{11}$/.test(v.videoId || "") && v.isPlayable !== false && !seen.has(v.videoId)) {
          seen.add(v.videoId);
          const byline = v.shortBylineText?.runs?.[0]; const channelPath = byline?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl;
          const seconds = text(v.lengthText).split(":").reduce((acc: number, part: string) => acc * 60 + Number(part), 0);
          videos.push({video_id: v.videoId, title: text(v.title) || v.videoId, channel_title: byline?.text || null, channel_url: channelPath ? `https://www.youtube.com${channelPath}` : null, thumbnail_url: v.thumbnail?.thumbnails?.at(-1)?.url || null, duration: seconds || null});
        }
        return;
      }
      if (node.continuationItemRenderer) { next = find(node.continuationItemRenderer, "continuationCommand")?.token || null; return; }
      for (const value of Object.values(node)) visit(value);
    };
    visit(page);
    if (!next) return {title: String(title), videos};
    if (tokens.has(next)) throw new Error("YouTube returned a repeated playlist page. Please retry.");
    tokens.add(next);
    const continued = await youtubeFetch("https://www.youtube.com/youtubei/v1/browse?prettyPrint=false", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({context, continuation: next}), signal: AbortSignal.timeout(15000)});
    if (!continued.ok) throw new Error("Could not read the complete playlist. Please retry.");
    page = await continued.json();
  }
  throw new Error("This playlist is too large for one import. Please use the local app.");
}
