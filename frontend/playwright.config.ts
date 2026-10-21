import { defineConfig } from "@playwright/test";
export default defineConfig({
  timeout: 60_000,
  testDir: "./e2e", use: { baseURL: "http://127.0.0.1:13000", trace: "retain-on-failure" },
  webServer: [
    { command: `"${process.env.E2E_PYTHON || "python"}" tests/e2e_server.py`, cwd: "../backend", url: "http://127.0.0.1:18000/health", reuseExistingServer: false },
    { command: "npm run dev -- --hostname 127.0.0.1 --port 13000", url: "http://127.0.0.1:13000", env: { BACKEND_API_URL: "http://127.0.0.1:18000/api", NEXT_DIST_DIR: ".next-e2e" }, reuseExistingServer: false },
  ],
});
