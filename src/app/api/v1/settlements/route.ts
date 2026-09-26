import { json, page, qDate, qStr, readJson, requirePermissionApi, withApi } from "@/lib/api";
import { postSettlement, type SettlementInput } from "@/server/services/deposits";
import { listVouchers } from "@/server/services/ledger";

export const dynamic = "force-dynamic";

/** GET /api/v1/settlements?from=&to=&q=&limit=&offset= — rupees paid back to depositors. */
export const GET = withApi(async (req, s) => {
  const { rows, total } = await listVouchers(s, {
    from: qDate(req, "from"),
    to: qDate(req, "to"),
    type: "SETTLEMENT",
    q: qStr(req, "q") ?? null,
    ...page(req),
  });
  return json({ settlements: rows, total });
});

/**
 * POST /api/v1/settlements — pay a depositor, in full or in part.
 * Refused if it is more than we owe them, or more rupees than the company holds.
 */
export const POST = withApi(async (req, s) => {
  await requirePermissionApi(s, "voucher.create");
  const posted = await postSettlement(s, await readJson<SettlementInput>(req));
  return json(posted, posted.duplicate ? 200 : 201);
});
