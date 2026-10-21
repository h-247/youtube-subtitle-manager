import {authenticatedLocalUser} from "../../../../../lib/local-sync-auth";
import {errorResponse} from "../../../../../lib/server-api";
import {disconnectForUser} from "../../../youtube/disconnect/route";
export async function POST(request:Request) {const id=await authenticatedLocalUser(request); if(!id)return errorResponse("Invalid local pairing.",401); return disconnectForUser(id);}
