import { currentSiteUser, errorResponse, json } from "../../../../lib/server-api";

export async function GET() {
  const user = await currentSiteUser();
  if (!user) return errorResponse("Sign in with ChatGPT to access your library.", 401);
  return json({ is_configured: false, is_connected: false });
}
