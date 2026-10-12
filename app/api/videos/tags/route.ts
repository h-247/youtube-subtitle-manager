import { currentSiteUser, database, errorResponse, json } from "../../../../lib/server-api";

export async function GET() {
  const user = await currentSiteUser();
  if (!user) return errorResponse("Sign in with ChatGPT to access your library.", 401);
  const [videoRows, tagRows] = await Promise.all([
    database().prepare("SELECT channel_tags FROM videos WHERE user_id = ? AND channel_tags IS NOT NULL").bind(user.userId).all<{ channel_tags: string }>(),
    database().prepare("SELECT DISTINCT tag FROM channel_tags WHERE user_id = ? ORDER BY tag").bind(user.userId).all<{ tag: string }>(),
  ]);
  const tags = new Set((tagRows.results ?? []).map((row) => row.tag));
  for (const row of videoRows.results ?? []) for (const tag of row.channel_tags.split(",")) if (tag.trim()) tags.add(tag.trim().replace(/^#/, "").toLowerCase());
  return json([...tags].sort());
}
