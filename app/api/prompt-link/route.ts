import { currentSiteUser, errorResponse, json } from "../../../lib/server-api";
import { normalizePromptLink, readPromptLink, writePromptLink } from "../../../lib/prompt-link-store";

export async function GET() {
  const user = await currentSiteUser();
  if (!user) return errorResponse("Sign in with ChatGPT to view your prompt link.", 401);
  return json({ chatgpt_prompt_link: await readPromptLink(user.userId) });
}

export async function PATCH(request: Request) {
  const user = await currentSiteUser();
  if (!user) return errorResponse("Sign in with ChatGPT to update your prompt link.", 401);
  const body = await request.json().catch(() => null) as { chatgpt_prompt_link?: unknown } | null;
  if (!body || !Object.hasOwn(body, "chatgpt_prompt_link")) return errorResponse("ChatGPT prompt link is required.");
  const value = normalizePromptLink(body.chatgpt_prompt_link);
  if (value === undefined) return errorResponse("Enter a valid HTTP or HTTPS ChatGPT link.");
  await writePromptLink(user.userId, value);
  return json({ chatgpt_prompt_link: value });
}
