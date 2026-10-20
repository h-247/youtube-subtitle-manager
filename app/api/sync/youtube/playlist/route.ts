import {authenticatedLocalUser} from "../../../../../lib/local-sync-auth";
import {errorResponse,json} from "../../../../../lib/server-api";
import {readManagedPlaylist,YouTubeError} from "../../../../../lib/youtube-playlists";
export async function GET(request:Request) {const id=await authenticatedLocalUser(request); if(!id)return errorResponse("Invalid local pairing.",401); try {return json(await readManagedPlaylist(id,new URL(request.url).searchParams.get("playlist_id")||""));} catch(error) {return errorResponse(error instanceof Error?error.message:"Could not read playlist.",error instanceof YouTubeError&&error.category==="AUTH_REQUIRED"?409:422);}}
