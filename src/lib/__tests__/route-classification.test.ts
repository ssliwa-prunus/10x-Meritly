import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMIN_ROUTES,
  ANY_SIGNED_IN_ROUTES,
  EMPLOYEE_ROUTES,
  matchesRoute,
  PROJECT_ROUTES,
  PROTECTED_ROUTES,
  PUBLIC_ROUTES,
  SET_PASSWORD_ROUTES,
} from "@/lib/route-access";

// The gate allows any path it does not list, so a new page or endpoint that nobody classified
// would be public. This rule walks src/pages instead of enumerating today's routes: every file
// must be explicitly public, or protected with exactly one role decision.

const PAGES_DIR = join(process.cwd(), "src", "pages");
// Every extension Astro turns into a route, not only the ones used today.
const ROUTE_FILE = /\.(astro|ts|js|mjs|md|mdx|html)$/;

function pageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith("_")) return []; // Astro ignores _-prefixed files and folders.
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return pageFiles(path);
    return ROUTE_FILE.test(entry.name) ? [path] : [];
  });
}

/** src/pages/projects/[id]/index.astro → /projects/sample */
function routeOf(file: string): string {
  const segments = relative(PAGES_DIR, file)
    .replace(ROUTE_FILE, "")
    .split(sep)
    .map((segment) => (segment.startsWith("[") ? "sample" : segment));
  if (segments.at(-1) === "index") segments.pop();
  return `/${segments.join("/")}`;
}

const ROLE_DECISIONS = [ADMIN_ROUTES, PROJECT_ROUTES, EMPLOYEE_ROUTES, ANY_SIGNED_IN_ROUTES, SET_PASSWORD_ROUTES];

const routes = pageFiles(PAGES_DIR).map((file) => ({ file: relative(process.cwd(), file), route: routeOf(file) }));

describe("route classification", () => {
  it("finds the pages to check", () => {
    expect(routes.length).toBeGreaterThan(10);
  });

  it.each(routes)("$file ($route) is public or has exactly one role decision", ({ route }) => {
    if (PUBLIC_ROUTES.includes(route)) return;
    expect(matchesRoute(route, PROTECTED_ROUTES), `${route} is neither public nor protected`).toBe(true);
    const decisions = ROLE_DECISIONS.filter((list) => matchesRoute(route, list)).length;
    expect(decisions, `${route} needs exactly one role decision in @/lib/route-access`).toBe(1);
  });

  it.each(ROLE_DECISIONS.flat())("role prefix %s also requires sign-in", (prefix) => {
    expect(matchesRoute(prefix, PROTECTED_ROUTES)).toBe(true);
  });

  it.each(PUBLIC_ROUTES)("public route %s still exists as a page", (route) => {
    expect(routes.map((r) => r.route)).toContain(route);
  });
});
