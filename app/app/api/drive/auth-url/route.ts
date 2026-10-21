import { env } from "cloudflare:workers";
import { currentSiteUser, database, errorResponse, json } from "../../../../../lib/server-api";
import { driveIsConfigured, driveRedirectUri } from "../../../../../lib/drive-service";

export async function GET(request: Request) {
  const user = await currentSiteUser();
  if (!user) return errorResponse("Sign in with ChatGPT to connect Google Drive.", 401);
  if (!driveIsConfigured()) return errorResponse("Google Drive OAuth is not configured for this Site yet.", 503);

  const stateBytes = crypto.getRandomValues(new Uint8Array(32));
  const state = Array.from(stateBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const expiresAt = Math.floor(Date.now() / 1000) + 600;
  const db = database();
  await db.prepare("DELETE FROM drive_oauth_states WHERE expires_at < ?").bind(Math.floor(Date.now() / 1000)).run();
  await db.prepare("INSERT INTO drive_oauth_states (state, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(state, user.userId, expiresAt).run();

  const redirectUri = driveRedirectUri(request.url);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive.file",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  }).toString();
  return json({ url: url.toString() });
}
