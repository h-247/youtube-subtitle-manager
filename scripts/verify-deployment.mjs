const baseUrl = process.env.SITE_URL?.replace(/\/$/, "");
const expectedRevision = process.env.EXPECTED_SITE_REVISION;
const smokeUserId = process.env.SITE_SMOKE_USER_ID;
const smokeUserEmail = process.env.SITE_SMOKE_USER_EMAIL;
if (!baseUrl || !expectedRevision || !smokeUserId || !smokeUserEmail) {
  throw new Error("Set SITE_URL, EXPECTED_SITE_REVISION, SITE_SMOKE_USER_ID, and SITE_SMOKE_USER_EMAIL.");
}

const deadline = Date.now() + 10 * 60_000;
const verificationStartedAt = Date.now();
let health;
let lastObservedHealth;
while (Date.now() < deadline) {
  try {
    const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
    if (response.ok) {
      const current = await response.json();
      lastObservedHealth = current;
      const heartbeatAt = Date.parse(current.scheduler?.last_completed_at || "");
      const heartbeatIsRecent = Number.isFinite(heartbeatAt) && heartbeatAt >= verificationStartedAt && Date.now() - heartbeatAt <= 900_000;
      if (response.ok && current.status === "ok" && current.revision === expectedRevision
        && current.scheduler?.healthy === true && current.scheduler?.last_status === "ok" && heartbeatIsRecent) {
        health = current;
        break;
      }
    }
    else {
      const current = await response.json().catch(() => null);
      if (current) lastObservedHealth = current;
    }
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 10_000));
}
if (!health) {
  const scheduler = lastObservedHealth?.scheduler;
  const detail = scheduler ? ` Last observed scheduler: status=${scheduler.last_status}, age_seconds=${scheduler.age_seconds ?? "unknown"}, error=${scheduler.health_error || scheduler.last_error || "none"}.` : " No health response was available.";
  throw new Error(`Timed out waiting for revision ${expectedRevision} and a healthy scheduler heartbeat completed after deployment verification began (no older than 15 minutes). Check the hosted jobs schedule and /api/health.${detail}`);
}

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
