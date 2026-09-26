import { json, page, qDate, qInt, qStr, readJson, requirePermissionApi, withApi } from "@/lib/api";
import { listDeposits, postDeposit, type DepositInput } from "@/server/services/deposits";

export const dynamic = "force-dynamic";

/** GET /api/v1/deposits?from=&to=&depositorId=&open=1&q=&limit=&offset= */
export const GET = withApi(async (req, s) => {
  const { rows, total, totals } = await listDeposits(s, {
    from: qDate(req, "from"),
    to: qDate(req, "to"),
    depositorId: qInt(req, "depositorId") ?? null,
    unallocatedOnly: qStr(req, "open") === "1",
    q: qStr(req, "q") ?? null,
    ...page(req),
  });
  return json({ deposits: rows, total, totals });
});

/**
 * POST /api/v1/deposits — record currency brought in by a depositor.
 * Send clientRef and a repeated call returns the same deposit instead of recording it twice.
 */
export const POST = withApi(async (req, s) => {
  await requirePermissionApi(s, "voucher.create");
  const posted = await postDeposit(s, await readJson<DepositInput>(req));
  return json(posted, posted.duplicate ? 200 : 201);
});
