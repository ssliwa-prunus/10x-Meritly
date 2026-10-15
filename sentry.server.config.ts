// Worker entry (wrangler.jsonc "main"): wraps the Astro Cloudflare handler so every request
// runs in its own Sentry scope and unhandled errors are reported and flushed via waitUntil.
import * as Sentry from "@sentry/cloudflare";
import handler from "@astrojs/cloudflare/entrypoints/server";

interface SentryEnv {
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
}

export default Sentry.withSentry(
  (env: SentryEnv) => ({
    // No DSN (e.g. CI without the secret) leaves the SDK disabled.
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? "development",
    // Release comes from the CF_VERSION_METADATA binding (see wrangler.jsonc).
    tracesSampleRate: env.SENTRY_ENVIRONMENT === "production" ? 0.1 : 1.0,
  }),
  handler,
);
