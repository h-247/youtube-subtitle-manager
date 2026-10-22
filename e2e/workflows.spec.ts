import { expect, test } from "@playwright/test";

const identity = (user: string) => ({"oai-authenticated-user-id": user, "oai-authenticated-user-email": `${user}@example.test`});

test("import saves captions, completes Drive, survives reload and interrupted confirmation, then deletes", async ({ page, request }) => {
  await page.setExtraHTTPHeaders(identity("workflow-user"));
  await page.goto("/dashboard/videos");
  await page.getByRole("button", {name: "Add ChatGPT prompt link", exact: true}).click();
  const promptDialog = page.getByRole("dialog", {name: "Shared ChatGPT prompt link"});
  await promptDialog.getByLabel("ChatGPT link", {exact: true}).fill("https://chatgpt.com/c/browser-prompt");
  await promptDialog.getByRole("button", {name: "Save link", exact: true}).click();
  await expect(promptDialog).toBeHidden();
  await page.reload();
  await expect(page.getByRole("link", {name: "Prompt", exact: true})).toHaveAttribute("href", "https://chatgpt.com/c/browser-prompt");
  await page.getByRole("button", {name: "Ingest Videos"}).click();
  await page.getByRole("textbox", {name: "Video URL"}).fill("https://www.youtube.com/watch?v=release0001");
  await page.getByRole("button", {name: "Add video", exact: true}).click();
  await expect(page.getByText("Release workflow video", {exact: true}).first()).toBeVisible();
  const dispatch = async () => {
    const response = await request.post("/api/internal/jobs/run", {headers: {Authorization: "Bearer browser-test"}});
    expect(response.ok(), await response.text()).toBe(true);
  };
  await dispatch();
  const health = await (await request.get("/api/health")).json();
  expect(health.revision).toMatch(/^[0-9a-f]{40}$/);
  expect(health.scheduler.last_status).toBe("ok");
  expect(health.scheduler.last_completed_at).toBeTruthy();
  expect((await request.get("/api/videos")).status()).toBe(401);
  const library = async () => (await (await request.get("/api/videos", {headers: identity("workflow-user")})).json()).items;
  expect((await request.get("/api/videos", {headers: identity("workflow-user")})).ok()).toBe(true);
  await expect.poll(async () => (await library())[0]?.drive_file_id).toBeTruthy();
  const video = (await library())[0];
  expect(video.status).toBe("COMPLETED");
  const saved = await request.get(`/api/videos/${video.id}/captions`, {headers: identity("workflow-user")});
  expect(await saved.text()).toContain("Saved release captions");
  await page.reload();
  await page.getByTitle("Edit video status or tags").click();
  await page.getByLabel("Watch status", {exact: true}).selectOption("DONE");
  await page.getByRole("textbox", {name: "New video tag"}).fill("release-proof");
  await page.getByRole("button", {name: "Save Changes"}).click();
  await expect(page.getByRole("dialog", {name: "Edit video"})).toBeHidden();
  await page.reload();
  await page.getByTitle("Edit video status or tags").click();
  await expect(page.getByLabel("Watch status", {exact: true})).toHaveValue("DONE");
  await expect(page.getByRole("button", {name: "release-proof", exact: true}).last()).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", {name: "Cancel", exact: true}).click();
  const before = await (await request.get("/__fixture/stats")).json();
  expect(before).toEqual({uploads: 1, captions: 1, files: 1});
  expect((await request.post("/__fixture/restart")).ok()).toBe(true);
  await dispatch();
  expect((await library())[0].drive_file_id).toBe(video.drive_file_id);
  expect(await (await request.get("/__fixture/stats")).json()).toEqual(before);
  await page.reload();
  page.once("dialog", dialog => dialog.accept());
  await page.getByTitle("Delete from library (leaves Google Drive file intact)").click();
  await expect.poll(async () => (await library()).length).toBe(0);
  await page.reload();
  await expect(page.getByText("Release workflow video", {exact: true})).toHaveCount(0);
});

test("paired API preferences, edits, deletions and reconnect are isolated", async ({ request }) => {
  const pair = async (user: string) => (await (await request.post("/api/sync/pair", {headers: identity(user)})).json()).token;
  const token = await pair("contract-a"), other = await pair("contract-b");
  const headers = {Authorization: `Bearer ${token}`};
  expect((await request.get("/api/sync/prompt-link")).status()).toBe(401);
  expect((await request.put("/api/sync/prompt-link", {headers, data: {}})).status()).toBe(422);
  expect((await request.put("/api/sync/prompt-link", {headers, data: {chatgpt_prompt_link: "javascript:alert(1)"}})).status()).toBe(422);
  const preference = {chatgpt_prompt_link: "https://chatgpt.com/c/shared"};
  expect((await request.put("/api/sync/prompt-link", {headers, data: preference})).ok()).toBe(true);
  expect(await (await request.get("/api/sync/prompt-link", {headers})).json()).toEqual(preference);
  expect(await (await request.get("/api/prompt-link", {headers: identity("contract-a")})).json()).toEqual(preference);
  expect((await request.patch("/api/prompt-link", {headers: identity("contract-a"), data: {chatgpt_prompt_link: "https://chatgpt.com/c/from-site"}})).ok()).toBe(true);
  expect(await (await request.get("/api/sync/prompt-link", {headers})).json()).toEqual({chatgpt_prompt_link: "https://chatgpt.com/c/from-site"});
  await request.put("/api/sync/prompt-link", {headers, data: preference});
  expect(await (await request.get("/api/sync/prompt-link", {headers: {Authorization: `Bearer ${other}`}})).json()).toEqual({chatgpt_prompt_link: null});
  const data = {video_id: "contract001", title: "Local record", youtube_url: "https://youtube.com/watch?v=contract001", status: "COMPLETED", subtitle_type: "MANUAL", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", tags: ["local"]};
  const pushed = await request.post("/api/sync/videos", {headers, data});
  expect(pushed.ok(), await pushed.text()).toBe(true);
  const {id} = await pushed.json();
  expect((await request.patch(`/api/videos/${id}`, {headers: identity("contract-b"), data: {watch_status: "DONE"}})).status()).toBe(404);
  expect((await request.patch(`/api/videos/${id}`, {headers: identity("contract-a"), data: {watch_status: "DONE", tags: ["edited"]}})).ok()).toBe(true);
  const snapshot = await (await request.get("/api/sync/library", {headers})).json();
  expect(snapshot.items[0]).toMatchObject({watch_status: "DONE", tags: ["edited"]});
  expect((await (await request.get("/api/sync/library", {headers: {Authorization: `Bearer ${other}`}})).json()).items).toEqual([]);
  const replacement = await pair("contract-a");
  expect((await request.get("/api/sync/library", {headers})).status()).toBe(401);
  const renewed = {Authorization: `Bearer ${replacement}`};
  expect(await (await request.get("/api/sync/prompt-link", {headers: renewed})).json()).toEqual(preference);
  expect((await request.delete("/api/sync/videos/contract001", {headers: renewed})).ok()).toBe(true);
  expect(await (await request.post("/api/sync/videos", {headers: renewed, data})).json()).toMatchObject({deleted: true});
  expect((await (await request.get("/api/sync/library", {headers: renewed})).json()).items).toEqual([]);
  expect((await request.put("/api/sync/prompt-link", {headers: renewed, data: {chatgpt_prompt_link: null}})).ok()).toBe(true);
  expect(await (await request.get("/api/sync/prompt-link", {headers: renewed})).json()).toEqual({chatgpt_prompt_link: null});
});

// This calls the companion's actual HTTP adapter, rather than duplicating its payload builder.
test("Python companion interoperates with the built Worker", async () => {
  test.setTimeout(90_000);
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { existsSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const python = process.env.COMPANION_PYTHON || (existsSync("backend/.venv/Scripts/python.exe") ? resolve("backend/.venv/Scripts/python.exe") : "python");
  const result = await promisify(execFile)(python, ["-m", "pytest", "tests/test_sites_contract.py", "-q"], {
    cwd: resolve("backend"), env: {...process.env, SITES_CONTRACT_URL: "http://127.0.0.1:8787"}, timeout: 60_000,
  });
  expect(result.stdout).toContain("1 passed");
});
