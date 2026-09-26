import { apiError, json, qDate, qInt, withApi } from "@/lib/api";
import { clientStatement } from "@/server/services/clients";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/reports/client-statement?partyId=&from=&to=
 * Both tracks with their own running balance: rupees the client owes us, and currency we owe them.
 */
export const GET = withApi(async (req, s) => {
  const partyId = qInt(req, "partyId");
  if (!partyId) return apiError("invalid", "partyId is required.", 400);
  const out = await clientStatement(s, partyId, qDate(req, "from"), qDate(req, "to"));
  if (!out.party) return apiError("not_found", "No such client.", 404);
  return json(out);
});
