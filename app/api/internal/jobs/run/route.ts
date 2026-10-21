import { env } from "cloudflare:workers";
import { runHostedJobs } from "../../../../../lib/hosted-jobs";

export async function POST(request: Request) {
  if (!env.HOSTED_JOBS_TOKEN || request.headers.get("authorization") !== `Bearer ${env.HOSTED_JOBS_TOKEN}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  await runHostedJobs();
  return Response.json({ completed: true });
}
