import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Plain Vitest config (no getViteConfig): unit tests cover pure TS in src/lib and must not boot the
// Astro/Cloudflare pipeline. Modules importing astro:env or astro:* virtual modules are not unit-testable here.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
