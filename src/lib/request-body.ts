import { logError } from "@/lib/error-log";

/** Largest body read through on an early answer; forms are far smaller, bigger uploads are cancelled. */
const DRAIN_LIMIT_BYTES = 64 * 1024;

/**
 * Releases a request body nobody will read. The middleware answers some requests (sign-in redirect,
 * 403, 503) before any handler consumes the body; leaving it unread made the local miniflare proxy
 * (miniflare 5.20261012, via @astrojs/cloudflare 14.4) fail the *next* request on the same
 * connection with `fetch failed`. `cancel()` alone does not help there (the request reaching the
 * middleware is a wrapper of the incoming one), so a small body is read through and discarded; a
 * body of unknown or larger size is cancelled rather than read. A body that is absent or already
 * read is left alone; a failure is logged, never thrown.
 */
export async function discardUnreadBody(request: Request): Promise<void> {
  if (request.body === null || request.bodyUsed) return;
  const length = Number(request.headers.get("content-length") ?? Number.NaN);
  try {
    if (Number.isInteger(length) && length >= 0 && length <= DRAIN_LIMIT_BYTES) await request.arrayBuffer();
    else await request.body.cancel();
  } catch (error) {
    logError("warn", "discardUnreadBody", error);
  }
}
