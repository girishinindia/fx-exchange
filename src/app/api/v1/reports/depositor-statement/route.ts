import { apiError, json, qDate, qInt, withApi } from "@/lib/api";
import { depositorStatement } from "@/server/services/deposits";

export const dynamic = "force-dynamic";

/** GET /api/v1/reports/depositor-statement?partyId=&from=&to= — one depositor's account, line by line. */
export const GET = withApi(async (req, s) => {
  const partyId = qInt(req, "partyId");
  if (!partyId) return apiError("invalid", "partyId is required.", 400);
  const out = await depositorStatement(s, partyId, qDate(req, "from"), qDate(req, "to"));
  if (!out.party) return apiError("not_found", "No such depositor.", 404);
  return json(out);
});
