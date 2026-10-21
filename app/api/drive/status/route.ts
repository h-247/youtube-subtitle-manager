import { currentSiteUser, database, errorResponse, json } from "../../../../lib/server-api";
import { driveIsConfigured } from "../../../../lib/drive-service";

export async function GET() {
  const user = await currentSiteUser();
  if (!user) return errorResponse("Sign in with ChatGPT to access your library.", 401);
  const connection = await database().prepare("SELECT 1 AS connected FROM drive_connections WHERE user_id = ?")
    .bind(user.userId).first<{ connected: number }>();
  const reconnect = await database().prepare(`SELECT 1 AS required FROM videos
    WHERE user_id = ? AND error_category = 'DRIVE_UPLOAD' AND drive_file_id IS NULL
      AND progress_message LIKE '%Google Drive access expired. Reconnect the Google account.%'
    LIMIT 1`).bind(user.userId).first<{ required: number }>();
  return json({ is_configured: driveIsConfigured(), is_connected: Boolean(connection), needs_reconnect: Boolean(reconnect) });
}
