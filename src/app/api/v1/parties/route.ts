import { json, page, qStr, readJson, requirePermissionApi, withApi } from "@/lib/api";
import { listParties, saveParty, type PartyInput } from "@/server/services/parties";

export const dynamic = "force-dynamic";

/** GET /api/v1/parties?kind=CLIENT|DEPOSITOR&q=&limit=&offset= */
export const GET = withApi(async (req, s) => {
  const kind = qStr(req, "kind");
  const { rows, total } = await listParties(s, {
    kind: kind === "CLIENT" || kind === "DEPOSITOR" ? kind : null,
    q: qStr(req, "q") ?? null,
    active: qStr(req, "active") === "all" ? null : true,
    ...page(req),
  });
  return json({ parties: rows, total });
});

/** POST /api/v1/parties — add a depositor / client. */
export const POST = withApi(async (req, s) => {
  await requirePermissionApi(s, "party.manage");
  const body = await readJson<PartyInput>(req);
  const saved = await saveParty(s, body);
  return json(saved, 201);
});
