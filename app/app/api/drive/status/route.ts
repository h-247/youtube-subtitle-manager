import { currentSiteUser, database, errorResponse, json } from "../../../../../lib/server-api";
import { driveIsConfigured } from "../../../../../lib/drive-service";

export async function GET() {
  const user = await currentSiteUser();
  if (!user) return errorResponse("Sign in with ChatGPT to access your library.", 401);
  const connection = await database().prepare("SELECT 1 AS connected FROM drive_connections WHERE user_id = ?")
    .bind(user.userId).first<{ connected: number }>();
  return json({ is_configured: driveIsConfigured(), is_connected: Boolean(connection) });
}
