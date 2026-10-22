const baseUrl = process.env.SITE_URL?.replace(/\/$/, "");
const expectedRevision = process.env.EXPECTED_SITE_REVISION;
const smokeUserId = process.env.SITE_SMOKE_USER_ID;
const smokeUserEmail = process.env.SITE_SMOKE_USER_EMAIL;
if (!baseUrl || !expectedRevision || !smokeUserId || !smokeUserEmail) {
  throw new Error("Set SITE_URL, EXPECTED_SITE_REVISION, SITE_SMOKE_USER_ID, and SITE_SMOKE_USER_EMAIL.");
}

const deadline = Date.now() + 10 * 60_000;
let health;
while (Date.now() < deadline) {
  try {
    const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
    if (response.ok) {
      const current = await response.json();
      if (current.revision === expectedRevision && current.scheduler?.last_status === "ok" && current.scheduler?.last_completed_at) {
        health = current;
        break;
      }
    }
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 10_000));
}
if (!health) throw new Error(`Timed out waiting for revision ${expectedRevision} and a successful scheduler heartbeat.`);

const unauthenticated = await fetch(`${baseUrl}/api/videos?page_size=1`, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
if (unauthenticated.status !== 401) throw new Error(`Unauthenticated library request returned ${unauthenticated.status}, expected 401.`);
const library = await fetch(`${baseUrl}/api/videos?page_size=1`, {
  headers: {
    "oai-authenticated-user-id": smokeUserId,
    "oai-authenticated-user-email": smokeUserEmail,
  },
  signal: AbortSignal.timeout(10_000),
  cache: "no-store",
});
if (!library.ok) throw new Error(`Authenticated library request returned ${library.status}.`);
const payload = await library.json();
if (!Array.isArray(payload.items) || !Number.isInteger(payload.total)) throw new Error("Authenticated library response has an invalid shape.");
console.log(JSON.stringify({ revision: health.revision, scheduler: health.scheduler, authenticated_library: "passed" }, null, 2));
