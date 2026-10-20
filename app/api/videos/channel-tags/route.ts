import { errorResponse } from "../../../../lib/server-api";
export async function POST() { return errorResponse("Channel tags have been removed. Assign tags to individual videos instead.", 410); }
