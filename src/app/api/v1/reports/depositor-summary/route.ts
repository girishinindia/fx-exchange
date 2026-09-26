import { json, qStr, withApi } from "@/lib/api";
import { depositorSummary } from "@/server/services/deposits";

export const dynamic = "force-dynamic";

/** GET /api/v1/reports/depositor-summary?q= — brought in, paid back, still owed, per depositor. */
export const GET = withApi(async (req, s) => {
  const rows = await depositorSummary(s, qStr(req, "q") ?? null);
  const outstanding = rows.reduce((a, r) => a + Number(r.outstanding_inr), 0).toFixed(2);
  return json({ depositors: rows, totalOutstandingInr: outstanding });
});
