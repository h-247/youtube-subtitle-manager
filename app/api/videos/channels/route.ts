import { currentSiteUser, database, errorResponse, json } from "../../../../lib/server-api";
export async function GET() {
  const user = await currentSiteUser();
  if (!user) return errorResponse("Sign in with ChatGPT to access your library.", 401);
  const rows = await database().prepare("SELECT channel_title, channel_url, tags_json, channel_tags FROM videos WHERE user_id = ? AND channel_title IS NOT NULL ORDER BY channel_title COLLATE NOCASE").bind(user.userId).all();
  const grouped = new Map<string, {channel_title: string; channel_url: unknown; tags: Set<string>; video_count: number}>();
  for (const row of rows.results ?? []) {
    const title = String(row.channel_title);
    if (!grouped.has(title)) grouped.set(title, { channel_title: title, channel_url: row.channel_url, tags: new Set(), video_count: 0 });
    const channel = grouped.get(title)!; channel.video_count++;
    const tags = row.tags_json != null ? JSON.parse(String(row.tags_json)) as string[] : String(row.channel_tags || "").split(",").map(t => t.trim()).filter(Boolean);
    for (const tag of tags) channel.tags.add(tag);
  }
  return json([...grouped.values()].map(c => ({...c, tags: [...c.tags].sort(), channel_tags: [...c.tags].join(", ") || null})));
}
