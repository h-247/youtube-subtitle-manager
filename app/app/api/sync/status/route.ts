import { authenticatedLocalUser } from "../../../../../lib/local-sync-auth";
import { database, errorResponse, json } from "../../../../../lib/server-api";
import { driveIsConfigured } from "../../../../../lib/drive-service";

export async function GET(request: Request) {
  const userId = await authenticatedLocalUser(request);
  if (!userId) return errorResponse("Invalid or revoked local sync token.", 401);
  const connection = await database().prepare("SELECT 1 AS connected FROM drive_connections WHERE user_id = ?")
    .bind(userId).first<{ connected: number }>();
  return json({
    is_connected: true,
    drive_is_configured: driveIsConfigured(),
    drive_is_connected: Boolean(connection),
  });
}

