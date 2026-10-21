import { currentSiteUser, database, errorResponse, json } from "../../../../lib/server-api";
import { driveIsConfigured } from "../../../../lib/drive-service";

export async function GET() {
  const user = await currentSiteUser();
  if (!user) return errorResponse("Sign in with ChatGPT to access your library.", 401);
  const isConfigured = driveIsConfigured();
  let connection: { connected: number } | null = null;
  let needsReconnect = false;
  try {
    const db = database();
    connection = await db.prepare("SELECT 1 AS connected FROM drive_connections WHERE user_id = ?")
      .bind(user.userId).first<{ connected: number }>();
    if (connection) {
      const failedUpload = await db.prepare(`SELECT 1 AS required FROM videos
        WHERE user_id = ? AND error_category = 'DRIVE_UPLOAD' AND drive_file_id IS NULL
        LIMIT 1`).bind(user.userId).first<{ required: number }>();
      needsReconnect = Boolean(failedUpload);
    }
  } catch (error) {
    console.error("Drive status lookup failed:", error instanceof Error ? error.message : String(error));
    // Keep the OAuth action available if status lookup fails. A known connection
    // with failed uploads should offer reauthorization rather than look healthy.
    needsReconnect = Boolean(connection);
  }
  return json({ is_configured: isConfigured, is_connected: Boolean(connection), needs_reconnect: needsReconnect });
}
