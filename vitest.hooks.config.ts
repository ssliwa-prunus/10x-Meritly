import { defineConfig } from "vitest/config";

// Agent hook proof (.claude/hooks): spawns the real hook scripts in throwaway git repos.
// Separate from vitest.config.ts so Stryker and `npm test` stay on src/.
export default defineConfig({
  test: {
    include: ["scripts/__tests__/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
  },
});
