import { currentSiteUser, database, errorResponse, json } from "../../../../lib/server-api";
import { disconnectDrive } from "../../../../lib/drive-service";

export async function POST() {
  const user = await currentSiteUser();
  if (!user) return errorResponse("Sign in with ChatGPT to access your library.", 401);
  await disconnectDrive(user.userId);
  return json({ message: "Google Drive disconnected successfully." });
}
