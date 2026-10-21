import { currentSiteUser, database, errorResponse, json } from "../../../../../lib/server-api";

export async function GET() {
  const user = await currentSiteUser();
  if (!user) return errorResponse("Sign in with ChatGPT to access your library.", 401);
  const drive = await database().prepare("SELECT 1 AS connected FROM drive_connections WHERE user_id = ?")
    .bind(user.userId).first<{ connected: number }>();
  return json({ id: user.userId, email: user.email, is_active: true, has_drive_connected: Boolean(drive), created_at: new Date(0).toISOString() });
}
