import { json, qInt, qStr, withApi } from "@/lib/api";
import { clientSummary, currencyDue } from "@/server/services/deals";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/reports/client-summary?q=&partyId=
 * Both client tracks at once: rupees owed to us, and the currency we still owe, per currency.
 */
export const GET = withApi(async (req, s) => {
  const [clients, due] = await Promise.all([
    clientSummary(s, qStr(req, "q") ?? null),
    currencyDue(s, qInt(req, "partyId")),
  ]);
  const receivable = clients.reduce((a, c) => a + Number(c.receivable_inr), 0).toFixed(2);
  return json({ clients, currencyDue: due, totalReceivableInr: receivable });
});
