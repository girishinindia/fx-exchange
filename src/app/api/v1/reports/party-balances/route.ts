import { json, qStr, withApi } from "@/lib/api";
import { partyBalances } from "@/server/services/ledger";

export const dynamic = "force-dynamic";

/** GET /api/v1/reports/party-balances?kind=CLIENT|DEPOSITOR */
export const GET = withApi(async (req, s) => {
  const kind = qStr(req, "kind");
  return json({ balances: await partyBalances(s, kind === "CLIENT" || kind === "DEPOSITOR" ? kind : undefined) });
});
