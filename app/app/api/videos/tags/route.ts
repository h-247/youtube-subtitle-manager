import { currentSiteUser, database, errorResponse, json, videoFromRow } from "../../../../../lib/server-api";
export async function GET() {
  const user = await currentSiteUser();
  if (!user) return errorResponse("Sign in with ChatGPT to access your library.", 401);
  const rows = await database().prepare("SELECT tags_json, channel_tags FROM videos WHERE user_id = ?").bind(user.userId).all();
  const tags = new Set<string>();
  for (const row of rows.results ?? []) {
    const values = row.tags_json != null ? JSON.parse(String(row.tags_json)) as string[] : String(row.channel_tags || "").split(",").map(t => t.trim()).filter(Boolean);
    for (const tag of values) tags.add(tag);
  }
  return json([...tags].sort());
}
