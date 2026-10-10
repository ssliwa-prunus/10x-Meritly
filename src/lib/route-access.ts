import { safeNext } from "@/lib/safe-next";

// ---------------------------------------------------------------------------
// Route classification and the access decision the middleware enforces. Pure (no astro:* imports)
// so it is unit-testable. Every page and endpoint under src/pages must be classified here: either
// public, or protected with exactly one role decision (route-classification.test.ts enforces it).
// RLS still decides which rows each role sees; this only gates who may reach a route at all.
// ---------------------------------------------------------------------------

/** Exact paths anyone may reach. /auth/confirm stays public: it is how an invited user gets signed in. */
export const PUBLIC_ROUTES = [
  "/",
  "/auth/signin",
  "/auth/signup",
  "/auth/confirm-email",
  "/auth/confirm",
  "/api/auth/signin",
  "/api/auth/signup",
  "/api/auth/signout",
  // Dev-only fixture page; it answers 404 in production.
  "/dev/projects-kitchen-sink",
];

/** Prefixes that require a signed-in user. */
export const PROTECTED_ROUTES = [
  "/dashboard",
  "/admin",
  "/api/admin",
  "/projects",
  "/api/projects",
  "/employees",
  "/api/employees",
  "/my-bonuses",
  "/auth/set-password",
  "/api/auth/set-password",
];
export const ADMIN_ROUTES = ["/admin", "/api/admin"];
/** Supervisor/Admin pages (projects, employees); RLS decides which rows each role sees. */
export const PROJECT_ROUTES = ["/projects", "/api/projects", "/employees", "/api/employees"];
/** Employee-only pages: a Supervisor must not use them as an unfiltered view of the team lines RLS lets them read. */
export const EMPLOYEE_ROUTES = ["/my-bonuses"];
/** Any signed-in role, deliberately. */
export const ANY_SIGNED_IN_ROUTES = ["/dashboard"];
/** Invite acceptance only: the middleware additionally requires an invite session (needs a client). */
export const SET_PASSWORD_ROUTES = ["/auth/set-password", "/api/auth/set-password"];

export const matchesRoute = (pathname: string, routes: readonly string[]) =>
  routes.some((route) => pathname.startsWith(route));

export interface AccessSession {
  signedIn: boolean;
  role: string | null;
  profileError: boolean;
}

export type AccessDecision =
  { kind: "allow" } | { kind: "redirect"; location: string } | { kind: "forbidden" } | { kind: "unavailable" };

/** What the middleware does with a request for `pathname` (+ `search`) from this session. */
export function decideAccess(pathname: string, search: string, session: AccessSession): AccessDecision {
  if (matchesRoute(pathname, PROTECTED_ROUTES) && !session.signedIn) {
    // Come back to the requested page after sign-in; an unsafe target is dropped, not forwarded.
    // API routes are not pages to land on (most are POST-only), so they get no return target.
    const target = pathname.startsWith("/api/") ? null : safeNext(pathname + search);
    return { kind: "redirect", location: target ? `/auth/signin?next=${encodeURIComponent(target)}` : "/auth/signin" };
  }

  const roleGates: [readonly string[], (role: string | null) => boolean][] = [
    [ADMIN_ROUTES, (role) => role === "admin"],
    [PROJECT_ROUTES, (role) => role === "supervisor" || role === "admin"],
    [EMPLOYEE_ROUTES, (role) => role === "employee"],
  ];
  for (const [routes, permits] of roleGates) {
    if (!matchesRoute(pathname, routes)) continue;
    if (session.profileError) return { kind: "unavailable" };
    if (!permits(session.role)) return { kind: "forbidden" };
  }

  return { kind: "allow" };
}
