import { authenticatedLocalUser } from "../../../../lib/local-sync-auth";
import { errorResponse, json } from "../../../../lib/server-api";

export async function GET(request: Request) {
  const userId = await authenticatedLocalUser(request);
  return userId ? json({ is_connected: true }) : errorResponse("Invalid or revoked local sync token.", 401);
}

