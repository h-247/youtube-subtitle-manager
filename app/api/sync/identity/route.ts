import { authenticatedLocalIdentity } from "../../../../lib/local-sync-auth";
import { errorResponse, json } from "../../../../lib/server-api";

export async function GET(request: Request) {
  const identity = await authenticatedLocalIdentity(request);
  if (!identity) return errorResponse("Invalid or revoked local pairing code.", 401);
  if (!identity.email) return errorResponse("Create a fresh pairing code from the Site to sign in locally.", 409);
  return json({ user_id: identity.userId, email: identity.email });
}
