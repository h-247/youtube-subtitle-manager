import { currentSiteUser, errorResponse, json } from "../../../../lib/server-api";

export async function GET() {
  const user = await currentSiteUser();
  if (!user) return errorResponse("Sign in with ChatGPT to access your library.", 401);
  return json({ id: user.userId, email: user.email, is_active: true, has_drive_connected: false, created_at: new Date(0).toISOString() });
}
