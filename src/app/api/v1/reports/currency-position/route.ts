import { json, withApi } from "@/lib/api";
import { currencyPosition, liquidity } from "@/server/services/ledger";

export const dynamic = "force-dynamic";

/** GET /api/v1/reports/currency-position — holdings plus the liquidity summary the dashboard shows. */
export const GET = withApi(async (_req, s) => {
  const [position, summary] = await Promise.all([currencyPosition(s), liquidity(s)]);
  return json({ position, summary: summary.totals, booksBalanced: Math.abs(Number(summary.tb.dr) - Number(summary.tb.cr)) < 0.005 });
});
