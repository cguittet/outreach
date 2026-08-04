import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:3000" },
  webServer: {
    command: "DEV_AUTH_EMAIL=owner@example.com DATABASE_URL=postgresql://postgres:postgres@localhost:5432/trucea pnpm dev",
    url: "http://127.0.0.1:3000/api/health",
    reuseExistingServer: true,
  },
});
