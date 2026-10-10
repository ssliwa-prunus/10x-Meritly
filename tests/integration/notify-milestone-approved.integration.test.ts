import { createClient, FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Risk #5 end to end: the real notify-milestone-approved Edge Function (`npx supabase functions
// serve`, with supabase/functions/.env pointing MAILPIT_URL at the local inbox) against the local
// Supabase and Mailpit. The oracle is the inbox, not the function's own counters.
//
// Fixture: built as the seeded supervisor through supabase-js with the anon key, so RLS applies
// exactly as in the app. The service-role client only plants notify_claimed_at (a held claim in
// case 7, an expired one in cases 5 and 7), because authenticated has no update privilege on
// milestone_result_lines; it never stands in for the supervisor. Every fixture uses unique addresses, so the shared inbox is searched by address
// and never wiped.
//
// Expected amounts, derived by hand: all four KPI scores are 100, and the KPI weights sum to 1
// (bonus_settings_kpi_weights_sum), so the weighted score is 100 and the multiplier is the maximum.
// The payout pool is then target pool × max ÷ max = the whole 1000.00. Both employees share one job
// role and one rating, so role weight × rating factor is equal and cancels out: the pool splits by
// time share alone, 0.60 / 1.00 × 1000.00 = 600.00 and 0.40 / 1.00 × 1000.00 = 400.00, both exact
// (no flooring loss). pl-PL formats them as "600,00 zł" / "400,00 zł" (with a non-breaking space).

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(
      `${name} is not set. The integration suite needs SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY ` +
        "(API_URL, ANON_KEY and SERVICE_ROLE_KEY from `npx supabase status -o env`), and MAILPIT_URL " +
        "(default http://127.0.0.1:54324).",
    );
  }
  return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_ANON_KEY = requireEnv("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const MAILPIT_URL = requireEnv("MAILPIT_URL", "http://127.0.0.1:54324").replace(/\/+$/, "");

const PASSWORD = "Meritly-Local-Passw0rd!";
const FUNCTION_NAME = "notify-milestone-approved";
const AMOUNT_A = "600,00 zł";
const AMOUNT_B = "400,00 zł";
// Delivery is synchronous inside the function, but allow the inbox a moment before asserting absence.
const SETTLE_MS = 1500;
const POLL_TIMEOUT_MS = 10_000;

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let fixtureSeq = 0;

const newClient = (key: string) =>
  createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function signIn(email: string): Promise<SupabaseClient> {
  const client = newClient(SUPABASE_ANON_KEY);
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in as ${email} failed: ${error.message}`);
  return client;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The whitespace-normalised text: the pl-PL currency format uses a non-breaking space. */
const normalise = (text: string) => text.replace(/\s+/g, " ");

interface InvokeResult {
  status: number;
  body: unknown;
}

async function invoke(client: SupabaseClient, milestoneId: string): Promise<InvokeResult> {
  const result = await client.functions.invoke<unknown>(FUNCTION_NAME, {
    body: { milestone_id: milestoneId },
  });
  const error: unknown = result.error;
  if (!error) return { status: 200, body: result.data };
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response;
    return { status: response.status, body: await response.json() };
  }
  throw new Error(`invoking ${FUNCTION_NAME} failed (is \`npx supabase functions serve\` running?)`, {
    cause: error,
  });
}

// ---------------------------------------------------------------------------
// Mailpit read API: GET /api/v1/search?query=to:<addr>, GET /api/v1/message/{ID}.
// ---------------------------------------------------------------------------

interface MailpitAddress {
  Address: string;
  Name: string;
}

interface MailpitSummary {
  ID: string;
  To: MailpitAddress[];
}

interface MailpitMessage {
  ID: string;
  To: MailpitAddress[];
  Text: string;
  HTML: string;
}

async function mailpit<T>(path: string): Promise<T> {
  const response = await fetch(`${MAILPIT_URL}${path}`);
  if (!response.ok) throw new Error(`Mailpit ${path} answered ${response.status}`);
  return (await response.json()) as T;
}

async function inbox(address: string): Promise<MailpitSummary[]> {
  const query = encodeURIComponent(`to:"${address}"`);
  const result = await mailpit<{ messages: MailpitSummary[] }>(`/api/v1/search?query=${query}`);
  return result.messages;
}

/** Waits until `count` messages reached the address (bounded), then lets the inbox settle. */
async function waitForInbox(address: string, count: number): Promise<MailpitSummary[]> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while ((await inbox(address)).length < count && Date.now() < deadline) await sleep(250);
  await sleep(500);
  return inbox(address);
}

/** Inbox after a fixed settle interval, for "nothing was sent" assertions. */
async function settledInbox(address: string): Promise<MailpitSummary[]> {
  await sleep(SETTLE_MS);
  return inbox(address);
}

const readMessage = (id: string) => mailpit<MailpitMessage>(`/api/v1/message/${id}`);

// ---------------------------------------------------------------------------
// Fixture: a project, a 1000.00 milestone scored 100 ×4, two employees with one job role, engaged
// at 0.60 and 0.40 with one rating; approved through approve_milestone unless `draft`.
// ---------------------------------------------------------------------------

interface Fixture {
  milestoneId: string;
  emailA: string;
  emailB: string;
}

let supervisor: SupabaseClient;
let jobRoleId: string;

function check<T>(result: { data: T | null; error: { message: string } | null }, step: string): T {
  if (result.error) throw new Error(`fixture: ${step} failed: ${result.error.message}`);
  if (result.data === null) throw new Error(`fixture: ${step} returned nothing`);
  return result.data;
}

async function createFixture({ draft = false } = {}): Promise<Fixture> {
  const id = `${runId}-${++fixtureSeq}`;
  const emailA = `notify-${id}-a@example.test`;
  const emailB = `notify-${id}-b@example.test`;

  const project = check(
    await supervisor
      .from("projects")
      .insert({
        name: `Notify IT ${id}`,
        start_date: "2026-01-01",
        end_date: "2026-12-31",
        status: "active",
        total_budget: 5000,
      })
      .select("id")
      .single<{ id: string }>(),
    "insert project",
  );

  const milestone = check(
    await supervisor
      .from("milestones")
      .insert({
        project_id: project.id,
        name: "Notify milestone",
        start_date: "2026-01-01",
        end_date: "2026-03-31",
        status: "active",
        target_pool: 1000,
      })
      .select("id")
      .single<{ id: string }>(),
    "insert milestone",
  );

  check(
    await supervisor
      .from("milestones")
      .update({ kpi_schedule: 100, kpi_budget: 100, kpi_quality: 100, kpi_risk: 100 })
      .eq("id", milestone.id)
      .select("id"),
    "score milestone",
  );

  const employees = check<{ id: string; email: string }[]>(
    await supervisor
      .from("employees")
      .insert([
        { full_name: `Notify A ${id}`, email: emailA, job_role_id: jobRoleId },
        { full_name: `Notify B ${id}`, email: emailB, job_role_id: jobRoleId },
      ])
      .select("id, email"),
    "insert employees",
  );
  const employeeId = (email: string) => {
    const row = employees.find((employee) => employee.email === email);
    if (!row) throw new Error(`fixture: employee ${email} missing`);
    return row.id;
  };

  check(
    await supervisor
      .from("milestone_engagements")
      .insert([
        { milestone_id: milestone.id, employee_id: employeeId(emailA), time_share: 0.6, rating: 3 },
        { milestone_id: milestone.id, employee_id: employeeId(emailB), time_share: 0.4, rating: 3 },
      ])
      .select("id"),
    "insert engagements",
  );

  if (!draft) {
    const { error } = await supervisor.rpc("approve_milestone", { p_milestone_id: milestone.id });
    if (error) throw new Error(`fixture: approve_milestone failed: ${error.message}`);
  }

  return { milestoneId: milestone.id, emailA, emailB };
}

async function expectNoMessages(fixture: Fixture) {
  expect(await settledInbox(fixture.emailA)).toHaveLength(0);
  expect(await settledInbox(fixture.emailB)).toHaveLength(0);
}

async function expectOneMessageEach(fixture: Fixture) {
  expect(await waitForInbox(fixture.emailA, 1)).toHaveLength(1);
  expect(await waitForInbox(fixture.emailB, 1)).toHaveLength(1);
}

const service = newClient(SUPABASE_SERVICE_ROLE_KEY);

async function plantClaim(milestoneId: string, claimedAt: Date) {
  const rows = check(
    await service
      .from("milestone_result_lines")
      .update({ notify_claimed_at: claimedAt.toISOString() })
      .eq("milestone_id", milestoneId)
      .select("id"),
    "plant notify_claimed_at",
  );
  expect(rows).toHaveLength(2);
}

beforeAll(async () => {
  const health = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=1`).catch(() => null);
  if (!health?.ok) throw new Error(`Mailpit is not reachable at ${MAILPIT_URL}`);

  supervisor = await signIn("supervisor@meritly.local");
  const role = check(
    await supervisor.from("job_roles").select("id").is("archived_at", null).limit(1).single<{ id: string }>(),
    "pick job role",
  );
  jobRoleId = role.id;
});

afterAll(async () => {
  await supervisor.auth.signOut();
});

describe("notify-milestone-approved (local Edge Function + Mailpit)", () => {
  it("1. an employee caller gets 403 forbidden and nothing is sent", async () => {
    const fixture = await createFixture();
    const employee = await signIn("employee@meritly.local");
    try {
      expect(await invoke(employee, fixture.milestoneId)).toEqual({ status: 403, body: { code: "forbidden" } });
    } finally {
      await employee.auth.signOut();
    }
    await expectNoMessages(fixture);
  });

  it("2. another supervisor gets 404 not_found and nothing is sent", async () => {
    const fixture = await createFixture();
    const supervisor2 = await signIn("supervisor2@meritly.local");
    try {
      expect(await invoke(supervisor2, fixture.milestoneId)).toEqual({ status: 404, body: { code: "not_found" } });
    } finally {
      await supervisor2.auth.signOut();
    }
    await expectNoMessages(fixture);
  });

  it("3. a Draft milestone gets 409 not_approved and nothing is sent", async () => {
    const fixture = await createFixture({ draft: true });
    expect(await invoke(supervisor, fixture.milestoneId)).toEqual({ status: 409, body: { code: "not_approved" } });
    await expectNoMessages(fixture);
  });

  it("4. each employee gets exactly one email, to them alone, with only their own amount", async () => {
    const fixture = await createFixture();
    expect(await invoke(supervisor, fixture.milestoneId)).toEqual({
      status: 200,
      body: { sent: 2, failed: 0, pending: 0 },
    });

    const inboxA = await waitForInbox(fixture.emailA, 1);
    const inboxB = await waitForInbox(fixture.emailB, 1);
    expect(inboxA).toHaveLength(1);
    expect(inboxB).toHaveLength(1);

    const messageA = await readMessage(inboxA[0].ID);
    const messageB = await readMessage(inboxB[0].ID);

    expect(messageA.To.map((to) => to.Address)).toEqual([fixture.emailA]);
    expect(messageB.To.map((to) => to.Address)).toEqual([fixture.emailB]);

    const textA = normalise(messageA.Text);
    const textB = normalise(messageB.Text);
    expect(textA).toContain(AMOUNT_A);
    expect(textA).not.toContain(AMOUNT_B);
    expect(textB).toContain(AMOUNT_B);
    expect(textB).not.toContain(AMOUNT_A);
    expect(normalise(messageA.HTML)).not.toContain(AMOUNT_B);
    expect(normalise(messageB.HTML)).not.toContain(AMOUNT_A);

    const lines = check(
      await supervisor.from("milestone_result_lines").select("notified_at").eq("milestone_id", fixture.milestoneId),
      "read result lines",
    ) as { notified_at: string | null }[];
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.notified_at !== null)).toBe(true);
  });

  it("5. invoking again sends nothing and reports nothing pending", async () => {
    const fixture = await createFixture();
    expect((await invoke(supervisor, fixture.milestoneId)).body).toEqual({ sent: 2, failed: 0, pending: 0 });
    await expectOneMessageEach(fixture);

    expect(await invoke(supervisor, fixture.milestoneId)).toEqual({
      status: 200,
      body: { sent: 0, failed: 0, pending: 0 },
    });
    expect(await settledInbox(fixture.emailA)).toHaveLength(1);
    expect(await settledInbox(fixture.emailB)).toHaveLength(1);

    // A re-send more than CLAIM_TIMEOUT_MS later: the first call's claim stays on the sent lines as
    // history, so age it past the timeout. Only notified_at may keep sent lines from being sent again.
    await plantClaim(fixture.milestoneId, new Date(Date.now() - 11 * 60 * 1000));
    expect(await invoke(supervisor, fixture.milestoneId)).toEqual({
      status: 200,
      body: { sent: 0, failed: 0, pending: 0 },
    });
    expect(await settledInbox(fixture.emailA)).toHaveLength(1);
    expect(await settledInbox(fixture.emailB)).toHaveLength(1);
  });

  it("6. four concurrent calls send each email once", async () => {
    const fixture = await createFixture();
    const results = await Promise.all(Array.from({ length: 4 }, () => invoke(supervisor, fixture.milestoneId)));

    expect(results.map((result) => result.status)).toEqual([200, 200, 200, 200]);
    const totalSent = results.reduce((sum, result) => sum + (result.body as { sent: number }).sent, 0);
    expect(totalSent).toBe(2);

    await expectOneMessageEach(fixture);
    expect(await settledInbox(fixture.emailA)).toHaveLength(1);
    expect(await settledInbox(fixture.emailB)).toHaveLength(1);
  });

  it("7. a claim held by another call reports pending; a stale claim is taken over", async () => {
    const fixture = await createFixture();

    await plantClaim(fixture.milestoneId, new Date());
    expect(await invoke(supervisor, fixture.milestoneId)).toEqual({
      status: 200,
      body: { sent: 0, failed: 0, pending: 2 },
    });
    await expectNoMessages(fixture);

    await plantClaim(fixture.milestoneId, new Date(Date.now() - 11 * 60 * 1000));
    expect(await invoke(supervisor, fixture.milestoneId)).toEqual({
      status: 200,
      body: { sent: 2, failed: 0, pending: 0 },
    });
    await expectOneMessageEach(fixture);
  });
});
