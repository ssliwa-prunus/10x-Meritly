import type { APIRoute } from "astro";
import { bonusReportFilename, buildBonusReportCsv, parseBonusReportFilter } from "@/lib/bonus-report";
import { logContextFrom, logError } from "@/lib/error-log";
import { getMessages } from "@/lib/i18n";
import { getBonusReport } from "@/lib/services/reports";
import { createClient } from "@/lib/supabase";

// CSV export of the aggregate bonus report: the same rows as /reports/bonuses, as a file. Middleware
// limits it to Supervisor/Admin; the request-scoped client makes RLS decide the scope. Header
// labels follow the request's language; amounts are always written for Polish Excel. Failures are
// plain-text status codes, never a redirect or an empty 200 file (getBonusReport logs the cause).

const textResponse = (status: number, body: string) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export const GET: APIRoute = async ({ url, request, cookies, locals }) => {
  const filter = parseBonusReportFilter(url.searchParams);
  if (filter.error) return textResponse(400, filter.error);

  const supabase = createClient(request.headers, cookies);
  const log = logContextFrom(locals, request);
  if (!supabase) {
    logError("error", "bonus report CSV", { code: "not_configured" }, { log });
    return textResponse(500, "not_configured");
  }

  const result = await getBonusReport(supabase, filter.data, log);
  if (result.error || !result.data) return textResponse(500, result.error ?? "load_failed");

  const csv = buildBonusReportCsv(result.data, getMessages(locals.locale).reports.csv);
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${bonusReportFilename(filter.data)}"`,
      "Cache-Control": "no-store",
    },
  });
};
