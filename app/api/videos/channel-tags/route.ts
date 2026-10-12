import { currentSiteUser, database, errorResponse, json } from "../../../../lib/server-api";

export async function POST(request: Request) {
  const user = await currentSiteUser();
  if (!user) return errorResponse("Sign in with ChatGPT to access your library.", 401);
  const body = await request.json().catch(() => ({})) as { channel_title?: string; tags?: string };
  const channelTitle = body.channel_title?.trim();
  if (!channelTitle) return errorResponse("Channel title is required.");
  const tags = [...new Set((body.tags ?? "").split(",").map((tag) => tag.trim().replace(/^#/, "").toLowerCase()).filter(Boolean))];
  const db = database();
  const statements = [db.prepare("DELETE FROM channel_tags WHERE user_id = ? AND channel_title = ?").bind(user.userId, channelTitle)];
  for (const tag of tags) statements.push(db.prepare("INSERT OR IGNORE INTO channel_tags (user_id, channel_title, tag) VALUES (?, ?, ?)").bind(user.userId, channelTitle, tag));
  statements.push(db.prepare("UPDATE videos SET channel_tags = ?, updated_at = ? WHERE user_id = ? AND channel_title = ?").bind(tags.join(", ") || null, new Date().toISOString(), user.userId, channelTitle));
  await db.batch(statements);
  return json({ channel_title: channelTitle, tags });
}
