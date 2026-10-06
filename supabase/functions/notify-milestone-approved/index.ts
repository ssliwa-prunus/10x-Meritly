// notify-milestone-approved: emails every engaged employee their own bonus after a milestone is
// approved, and stamps milestone_result_lines.notified_at for each message the provider confirmed.
// It reads the unsent lines and writes notified_at with the secret key; it runs in Supabase Edge
// Functions, never in the Worker. Safe to call again: only lines with notified_at null are sent.
//
// Request:  POST { "milestone_id": "<uuid>" } with the signed-in user's JWT (verify_jwt = true).
// Responses:
//   200 { sent, failed }                 sent/failed message counts (both 0 when nothing is unsent)
//   400 { code: "invalid_request" }      body is not { milestone_id: uuid }
//   403 { code: "forbidden" }            caller is not a Supervisor (Admins are read-only)
//   404 { code: "not_found" }            milestone not visible to the caller, or not the caller's project
//   409 { code: "not_approved" }         the milestone is not approved
//   500 { code: "email_not_configured" } neither Resend (RESEND_API_KEY + MAIL_FROM) nor MAILPIT_URL is set
//   500 { code: "notify_failed" }        a lookup or the notified_at stamp failed (logged)
//   502 { code: "send_failed" }          there was something to send and no message was confirmed
//
// Transport, chosen by env:
//   RESEND_API_KEY + MAIL_FROM  POST https://api.resend.com/emails/batch in chunks of <= 100, with
//                               Idempotency-Key milestone-approved/<milestone_id>/<sha256 of the
//                               chunk's sorted line ids>, so a retry of the same unsent set within
//                               24h cannot double-send.
//   MAILPIT_URL                 POST <MAILPIT_URL>/api/v1/send per message (local development only).
//   APP_URL                     base of the /my-bonuses link.
//
// Logging: the milestone id and counts only, never figures or email addresses.

import { withSupabase } from "npm:@supabase/server@^1";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESEND_BATCH_URL = "https://api.resend.com/emails/batch";
const RESEND_BATCH_LIMIT = 100;
const LOCAL_FROM = "Meritly <no-reply@meritly.local>";
const NO_ACCOUNT_LINE =
  "You don't have a Meritly account yet — ask your supervisor to send you an invite to see this in the app.";

interface MilestoneRow {
  id: string;
  status: string;
  projects: { supervisor_id: string } | null;
}

interface LineRow {
  id: string;
  project_name: string;
  milestone_name: string;
  start_date: string;
  end_date: string;
  bonus: number | string;
  employees: {
    email: string;
    full_name: string;
    profile_id: string | null;
    activated_at: string | null;
  } | null;
}

interface Message {
  lineId: string;
  to: string;
  toName: string;
  subject: string;
  text: string;
  html: string;
}

type Transport = { kind: "resend"; apiKey: string; from: string } | { kind: "mailpit"; url: string; from: string };

const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

async function readMilestoneId(req: Request): Promise<string | null> {
  try {
    const body: unknown = await req.json();
    if (typeof body !== "object" || body === null) return null;
    const value = (body as Record<string, unknown>).milestone_id;
    return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

function chooseTransport(): Transport | null {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("MAIL_FROM");
  if (apiKey && from) return { kind: "resend", apiKey, from };
  const mailpit = Deno.env.get("MAILPIT_URL");
  if (mailpit) return { kind: "mailpit", url: mailpit.replace(/\/+$/, ""), from: from || LOCAL_FROM };
  return null;
}

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const pln = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" });

function buildMessage(line: LineRow, appUrl: string): Message | null {
  const employee = line.employees;
  if (!employee) return null;
  const link = `${appUrl}/my-bonuses`;
  const period = `${line.start_date} – ${line.end_date}`;
  const bonus = pln.format(Number(line.bonus));
  const hasAccount = employee.profile_id !== null && employee.activated_at !== null;
  const subject = `Your bonus for ${line.milestone_name} — ${line.project_name}`;

  const text = [
    `Hello ${employee.full_name},`,
    "",
    `Your bonus for a completed milestone has been approved.`,
    "",
    `Project: ${line.project_name}`,
    `Milestone: ${line.milestone_name}`,
    `Period: ${period}`,
    `Bonus: ${bonus}`,
    "",
    `See it in Meritly: ${link}`,
    ...(hasAccount ? [] : ["", NO_ACCOUNT_LINE]),
  ].join("\n");

  const e = escapeHtml;
  const html = [
    `<p>Hello ${e(employee.full_name)},</p>`,
    `<p>Your bonus for a completed milestone has been approved.</p>`,
    "<ul>",
    `<li>Project: ${e(line.project_name)}</li>`,
    `<li>Milestone: ${e(line.milestone_name)}</li>`,
    `<li>Period: ${e(period)}</li>`,
    `<li>Bonus: <strong>${e(bonus)}</strong></li>`,
    "</ul>",
    `<p><a href="${e(link)}">See it in Meritly</a></p>`,
    ...(hasAccount ? [] : [`<p>${e(NO_ACCOUNT_LINE)}</p>`]),
  ].join("\n");

  return { lineId: line.id, to: employee.email, toName: employee.full_name, subject, text, html };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Sends one Resend batch; returns the line ids the provider confirmed (all or none). */
async function sendResendBatch(
  transport: Extract<Transport, { kind: "resend" }>,
  milestoneId: string,
  batch: Message[],
): Promise<string[]> {
  const ids = batch.map((message) => message.lineId);
  const key = `milestone-approved/${milestoneId}/${await sha256Hex([...ids].sort().join(","))}`;
  try {
    const response = await fetch(RESEND_BATCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${transport.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify(
        batch.map((message) => ({
          from: transport.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        })),
      ),
    });
    if (!response.ok) {
      console.error("notify-milestone-approved: Resend batch rejected", {
        milestoneId,
        status: response.status,
        count: batch.length,
      });
      return [];
    }
    return ids;
  } catch (error) {
    console.error("notify-milestone-approved: Resend batch failed", {
      milestoneId,
      count: batch.length,
      name: error instanceof Error ? error.name : typeof error,
    });
    return [];
  }
}

/** Mailpit's From: "Name <address>" or a bare address. */
function parseFrom(from: string): { Email: string; Name?: string } {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  if (!match) return { Email: from.trim() };
  return match[1] ? { Email: match[2], Name: match[1] } : { Email: match[2] };
}

async function sendMailpit(transport: Extract<Transport, { kind: "mailpit" }>, message: Message): Promise<boolean> {
  try {
    const response = await fetch(`${transport.url}/api/v1/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        From: parseFrom(transport.from),
        To: [{ Email: message.to, Name: message.toName }],
        Subject: message.subject,
        Text: message.text,
        HTML: message.html,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return reply(400, { code: "invalid_request" });

    const milestoneId = await readMilestoneId(req);
    if (!milestoneId) return reply(400, { code: "invalid_request" });

    // Role through the caller's own client. Only Supervisors notify; Admins are read-only.
    const { data: role, error: roleError } = await ctx.supabase.rpc("current_app_role");
    if (roleError) {
      console.error("notify-milestone-approved: role lookup failed", { code: roleError.code });
      return reply(500, { code: "notify_failed" });
    }
    if (role !== "supervisor") return reply(403, { code: "forbidden" });

    // Visibility through RLS first, then explicit ownership of the parent project.
    const { data: milestone, error: loadError } = await ctx.supabase
      .from("milestones")
      .select("id, status, projects!inner(supervisor_id)")
      .eq("id", milestoneId)
      .maybeSingle<MilestoneRow>();
    if (loadError) {
      console.error("notify-milestone-approved: milestone lookup failed", { milestoneId, code: loadError.code });
      return reply(500, { code: "notify_failed" });
    }
    if (!milestone || !milestone.projects || milestone.projects.supervisor_id !== ctx.userClaims?.id) {
      return reply(404, { code: "not_found" });
    }
    if (milestone.status !== "approved") return reply(409, { code: "not_approved" });

    const transport = chooseTransport();
    if (!transport) {
      console.error("notify-milestone-approved: no email transport configured", { milestoneId });
      return reply(500, { code: "email_not_configured" });
    }

    // Unsent lines and their recipients through the admin client (notified_at is system-written).
    const { data, error: linesError } = await ctx.supabaseAdmin
      .from("milestone_result_lines")
      .select(
        "id, project_name, milestone_name, start_date, end_date, bonus, employees!inner(email, full_name, profile_id, activated_at)",
      )
      .eq("milestone_id", milestoneId)
      .is("notified_at", null)
      .order("id", { ascending: true });
    if (linesError) {
      console.error("notify-milestone-approved: line lookup failed", { milestoneId, code: linesError.code });
      return reply(500, { code: "notify_failed" });
    }
    const lines = (data ?? []) as LineRow[];
    if (lines.length === 0) {
      console.log("notify-milestone-approved: nothing to send", { milestoneId });
      return reply(200, { sent: 0, failed: 0 });
    }

    const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/+$/, "");
    const messages = lines.map((line) => buildMessage(line, appUrl)).filter((m): m is Message => m !== null);

    let sent = 0;
    let stampFailed = false;
    const stamp = async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await ctx.supabaseAdmin
        .from("milestone_result_lines")
        .update({ notified_at: new Date().toISOString() })
        .in("id", ids)
        .is("notified_at", null);
      if (error) {
        stampFailed = true;
        console.error("notify-milestone-approved: stamping notified_at failed", {
          milestoneId,
          count: ids.length,
          code: error.code,
        });
        return;
      }
      sent += ids.length;
    };

    if (transport.kind === "resend") {
      for (let start = 0; start < messages.length; start += RESEND_BATCH_LIMIT) {
        const batch = messages.slice(start, start + RESEND_BATCH_LIMIT);
        await stamp(await sendResendBatch(transport, milestoneId, batch));
      }
    } else {
      for (const message of messages) {
        if (await sendMailpit(transport, message)) await stamp([message.lineId]);
      }
    }

    const failed = lines.length - sent;
    console.log("notify-milestone-approved: done", { milestoneId, sent, failed });
    if (sent === 0) return reply(stampFailed ? 500 : 502, { code: stampFailed ? "notify_failed" : "send_failed" });
    return reply(200, { sent, failed });
  }),
};
