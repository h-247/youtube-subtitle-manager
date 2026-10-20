import {authenticatedLocalUser} from "../../../../../lib/local-sync-auth";
import {errorResponse,json} from "../../../../../lib/server-api";
import {youtubeStatus,processOnePlaylistRemoval} from "../../../../../lib/youtube-playlists";
export async function GET(request:Request) {const id=await authenticatedLocalUser(request); if(!id)return errorResponse("Invalid local pairing.",401); await processOnePlaylistRemoval(id); return json({...await youtubeStatus(id),connect_url:new URL("/api/youtube/connect",request.url).toString()});}
