import { describe, expect, it } from "vitest";
import { decideAccess, type AccessSession } from "@/lib/route-access";

// Expected outcomes come from the role rules (CLAUDE.md "Roles" and auth flow, PRD visibility),
// not from reading the gate: Admin pages are admin-only, project/employee pages are for
// Supervisors and Admins, /my-bonuses is for Employees only, and a signed-out visitor is sent to
// sign in (pages keep a return target, API routes do not).

const anon: AccessSession = { signedIn: false, role: null, profileError: false };
const as = (role: string | null): AccessSession => ({ signedIn: true, role, profileError: false });
const profileDown: AccessSession = { signedIn: true, role: null, profileError: true };

const allow = { kind: "allow" };
const forbidden = { kind: "forbidden" };
const unavailable = { kind: "unavailable" };
const signIn = (location: string) => ({ kind: "redirect", location });

describe("decideAccess — signed-out visitor", () => {
  it.each([
    ["/projects", "?tab=x", signIn("/auth/signin?next=%2Fprojects%3Ftab%3Dx")],
    ["/admin", "", signIn("/auth/signin?next=%2Fadmin")],
    ["/my-bonuses", "", signIn("/auth/signin?next=%2Fmy-bonuses")],
    ["/dashboard", "", signIn("/auth/signin?next=%2Fdashboard")],
    // API routes are not pages to land on, so no return target.
    ["/api/projects", "", signIn("/auth/signin")],
    ["/api/admin/job-roles", "", signIn("/auth/signin")],
    // Prefix over-match fails closed: a sibling path is gated too.
    ["/projectsX", "", signIn("/auth/signin?next=%2FprojectsX")],
    // Public pages and auth endpoints.
    ["/", "", allow],
    ["/auth/signin", "", allow],
    ["/auth/confirm", "?token_hash=x&type=invite", allow],
    ["/api/auth/signin", "", allow],
  ])("%s%s → %o", (pathname, search, expected) => {
    expect(decideAccess(pathname, search, anon)).toEqual(expected);
  });

  it("drops a return target that is too long to be safe", () => {
    const longPath = `/projects/${"a".repeat(600)}`;
    expect(decideAccess(longPath, "", anon)).toEqual(signIn("/auth/signin"));
  });
});

describe("decideAccess — role × route matrix", () => {
  const routes = [
    "/admin",
    "/api/admin/job-roles",
    "/projects",
    "/projects/p1/milestones/m1",
    "/api/projects/p1/milestones/m1/notify",
    "/employees",
    "/api/employees/e1/invite",
    "/my-bonuses",
    "/dashboard",
  ] as const;

  const matrix: Record<string, Record<(typeof routes)[number], object>> = {
    employee: {
      "/admin": forbidden,
      "/api/admin/job-roles": forbidden,
      "/projects": forbidden,
      "/projects/p1/milestones/m1": forbidden,
      "/api/projects/p1/milestones/m1/notify": forbidden,
      "/employees": forbidden,
      "/api/employees/e1/invite": forbidden,
      "/my-bonuses": allow,
      "/dashboard": allow,
    },
    supervisor: {
      "/admin": forbidden,
      "/api/admin/job-roles": forbidden,
      "/projects": allow,
      "/projects/p1/milestones/m1": allow,
      "/api/projects/p1/milestones/m1/notify": allow,
      "/employees": allow,
      "/api/employees/e1/invite": allow,
      "/my-bonuses": forbidden,
      "/dashboard": allow,
    },
    admin: {
      "/admin": allow,
      "/api/admin/job-roles": allow,
      "/projects": allow,
      "/projects/p1/milestones/m1": allow,
      "/api/projects/p1/milestones/m1/notify": allow,
      "/employees": allow,
      "/api/employees/e1/invite": allow,
      "/my-bonuses": forbidden,
      "/dashboard": allow,
    },
  };

  for (const [role, row] of Object.entries(matrix)) {
    it.each(routes.map((route) => [route, row[route]] as const))(`${role} on %s → %o`, (route, expected) => {
      expect(decideAccess(route, "", as(role))).toEqual(expected);
    });
  }
});

describe("decideAccess — failing closed", () => {
  it.each(["/admin", "/projects", "/my-bonuses", "/administrator"])(
    "a signed-in user without a profile is forbidden on %s",
    (route) => {
      expect(decideAccess(route, "", as(null))).toEqual(forbidden);
    },
  );

  it.each(["/admin", "/projects", "/my-bonuses"])("an unknown role is forbidden on %s", (route) => {
    expect(decideAccess(route, "", as("superuser"))).toEqual(forbidden);
  });

  it.each(["/admin", "/api/projects", "/employees", "/my-bonuses"])(
    "a failed profile lookup answers 503 on %s",
    (route) => {
      expect(decideAccess(route, "", profileDown)).toEqual(unavailable);
    },
  );

  it("a failed profile lookup does not block role-free pages", () => {
    expect(decideAccess("/dashboard", "", profileDown)).toEqual(allow);
  });
});
