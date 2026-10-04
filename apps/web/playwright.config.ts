import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:3000" },
  webServer: [
    {
      command: "pnpm --filter @aevia/api dev",
      url: "http://localhost:4000/health",
      reuseExistingServer: true,
      env: { PORT: "4000" },
      timeout: 60_000,
    },
    {
      command: "pnpm dev",
      url: "http://localhost:3000/c/drmetz",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
