import { expect, test } from "@playwright/test";

test("background dispatch runs without a dashboard and requires authorization", async ({ request }) => {
  const migrationDenied = await request.post("/api/internal/migrations/apply");
  expect(migrationDenied.status()).toBe(401);
  const migrated = await request.post("/api/internal/migrations/apply", { headers: { Authorization: "Bearer browser-test" } });
  expect(migrated.ok(), await migrated.text()).toBe(true);
  expect((await migrated.json()).complete).toBe(true);
  const denied = await request.post("/api/internal/jobs/run");
  expect(denied.status()).toBe(401);
  const dispatched = await request.post("/api/internal/jobs/run", { headers: { Authorization: "Bearer browser-test" } });
  expect(dispatched.ok(), await dispatched.text()).toBe(true);
});

test("sign-in page links to ChatGPT authentication", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "YouTube Subtitle Manager" })).toBeVisible();
  await expect(page.getByRole("link", { name: /continue with chatgpt/i })).toHaveAttribute(
    "href",
    /signin-with-chatgpt/,
  );
});

test("authenticated visitor can open the video import dialog", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "oai-authenticated-user-id": "browser-check", "oai-authenticated-user-email": "browser-check@example.test" });
  await page.goto("/dashboard/videos");
  await expect(page.getByRole("button", { name: "Ingest Videos" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Ingest Videos" }).click();
  const dialog = page.getByRole("dialog", { name: "Add videos" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Single video" })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("button", { name: "YouTube playlist" })).toBeVisible();
});
