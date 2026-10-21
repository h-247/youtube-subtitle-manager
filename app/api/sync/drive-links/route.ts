import { authenticatedLocalUser } from "../../../../lib/local-sync-auth";
import { database, errorResponse, json } from "../../../../lib/server-api";

const PAGE_SIZE = 200;

export async function GET(request: Request) {
  const userId = await authenticatedLocalUser(request);
  if (!userId) return errorResponse("Invalid or revoked local sync token.", 401);

  const offsetValue = new URL(request.url).searchParams.get("offset") ?? "0";
  if (!/^\d{1,8}$/.test(offsetValue)) return errorResponse("Invalid offset.");
  const offset = Number(offsetValue);
  const result = await database().prepare(`SELECT video_id, drive_file_id, drive_file_url
    FROM videos WHERE user_id = ? AND drive_file_id IS NOT NULL AND drive_file_url IS NOT NULL
    ORDER BY id LIMIT ? OFFSET ?`).bind(userId, PAGE_SIZE, offset).all<{
      video_id: string; drive_file_id: string; drive_file_url: string;
    }>();
  const items = result.results ?? [];
  return json({ items, next_offset: items.length === PAGE_SIZE ? offset + PAGE_SIZE : null });
}
