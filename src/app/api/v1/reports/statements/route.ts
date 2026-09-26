import { apiError, json, qDate, qStr, withApi } from "@/lib/api";
import { fyStartISO, todayISO } from "@/lib/format";
import { getCompanyInfo } from "@/lib/company";
import { runReport } from "@/lib/report-access";
import { CA_PACK } from "@/lib/reports";

export const dynamic = "force-dynamic";

const ALLOWED = new Set<string>([...CA_PACK, "ageing", "clientsummary", "depositorsummary", "depositorprofit", "cycles", "currencydue"]);

/**
 * GET /api/v1/reports/statements?name=profitloss&from=&to=
 * The accounting statements, as the portal builds them — same columns, same totals, same note —
 * so a phone or a spreadsheet macro shows exactly what the portal shows.
 * Without `name`, returns the whole pack the CA is handed.
 */
export const GET = withApi(async (req, s) => {
  const company = await getCompanyInfo(s);
  const from = qDate(req, "from") ?? fyStartISO(company.fiscalYearStartMonth);
  const to = qDate(req, "to") ?? todayISO();
  const name = qStr(req, "name");

  if (name && !ALLOWED.has(name)) {
    return apiError("not_found", `Unknown statement. Try one of: ${[...ALLOWED].join(", ")}.`, 404);
  }

  const names = name ? [name] : [...CA_PACK];
  const out: Record<string, unknown> = {};
  for (const key of names) {
    const run = await runReport(s, key, { from, to });
    if (!run || !run.access.ok || !run.result) continue;   // silently skip what this user may not see
    out[key] = {
      title: run.def.title,
      columns: run.result.columns,
      rows: run.result.rows,
      totals: run.result.totals,
      note: run.result.note,
    };
  }
  if (Object.keys(out).length === 0) return apiError("forbidden", "Permission denied: report.view", 403);
  return json({ period: { from, to }, statements: out });
});
