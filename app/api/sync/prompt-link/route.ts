import { authenticatedLocalUser } from "../../../../lib/local-sync-auth";
import { errorResponse, json } from "../../../../lib/server-api";
import { normalizePromptLink, readPromptLink, writePromptLink } from "../../../../lib/prompt-link-store";

export async function GET(request: Request) {
  const userId = await authenticatedLocalUser(request);
  if (!userId) return errorResponse("Invalid or revoked local sync token.", 401);
  return json({ chatgpt_prompt_link: await readPromptLink(userId) });
}

export async function PUT(request: Request) {
  const userId = await authenticatedLocalUser(request);
  if (!userId) return errorResponse("Invalid or revoked local sync token.", 401);
  const body = await request.json().catch(() => null) as { chatgpt_prompt_link?: unknown } | null;
  if (!body || !Object.hasOwn(body, "chatgpt_prompt_link")) return errorResponse("ChatGPT prompt link is required.");
  const value = normalizePromptLink(body.chatgpt_prompt_link);
  if (value === undefined) return errorResponse("Enter a valid HTTP or HTTPS ChatGPT link.");
  await writePromptLink(userId, value);
  return json({ chatgpt_prompt_link: value });
}
