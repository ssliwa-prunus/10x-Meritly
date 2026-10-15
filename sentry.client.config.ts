// Browser SDK, injected into every page by the @sentry/astro integration.
import * as Sentry from "@sentry/astro";

Sentry.init({
  // The DSN is public: it only allows sending events to this project.
  dsn: "https://73d65e545dcc687d98d6662f7830d4aa@o4512261711593472.ingest.de.sentry.io/4512262355812432",
  environment: import.meta.env.PROD ? "production" : "development",
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
  // Trace headers go to our own API routes only, never to Supabase or third parties.
  tracePropagationTargets: [/^\/api\//],
});
