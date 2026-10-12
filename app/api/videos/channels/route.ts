import { currentSiteUser, database, errorResponse, json } from "../../../../lib/server-api";

export async function GET() {
  const user = await currentSiteUser();
  if (!user) return errorResponse("Sign in with ChatGPT to access your library.", 401);
  const [channels, tags] = await Promise.all([
    database().prepare("SELECT channel_title, MAX(channel_url) AS channel_url, GROUP_CONCAT(DISTINCT channel_tags) AS channel_tags, COUNT(*) AS video_count FROM videos WHERE user_id = ? AND channel_title IS NOT NULL GROUP BY channel_title ORDER BY channel_title COLLATE NOCASE").bind(user.userId).all<{ channel_title: string; channel_url: string | null; channel_tags: string | null; video_count: number }>(),
    database().prepare("SELECT channel_title, tag FROM channel_tags WHERE user_id = ? ORDER BY tag").bind(user.userId).all<{ channel_title: string; tag: string }>(),
  ]);
  const byChannel = new Map<string, Set<string>>();
  for (const row of tags.results ?? []) {
    if (!byChannel.has(row.channel_title)) byChannel.set(row.channel_title, new Set());
    byChannel.get(row.channel_title)!.add(row.tag);
  }
  return json((channels.results ?? []).map((row) => {
    const assigned = byChannel.get(row.channel_title) ?? new Set<string>();
    for (const raw of (row.channel_tags ?? "").split(",")) if (raw.trim()) assigned.add(raw.trim().replace(/^#/, "").toLowerCase());
    const values = [...assigned].sort();
    return { channel_title: row.channel_title, channel_url: row.channel_url, channel_tags: values.join(", ") || null, tags: values, video_count: Number(row.video_count) };
  }));
}
