import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Network-dependent suites (local Supabase, `npx supabase functions serve`, Mailpit). Kept apart
// from vitest.config.ts so `npm test` and Stryker stay hermetic. Run with `npm run test:integration`;
// the suites need SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (from
// `npx supabase status -o env`) and optionally MAILPIT_URL, and fail (never skip) when one is missing.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/integration/**/*.integration.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
