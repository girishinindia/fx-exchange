import { json, page, qDate, qStr, readJson, requirePermissionApi, withApi } from "@/lib/api";
import { clientPositions, postReceipt, type ReceiptInput } from "@/server/services/clients";
import { listVouchers } from "@/server/services/ledger";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/receipts?from=&to=&q= — rupees received from clients.
 * With `outstanding=1`, returns what each client still owes instead.
 */
export const GET = withApi(async (req, s) => {
  if (qStr(req, "outstanding") === "1") {
    const positions = await clientPositions(s);
    return json({ outstanding: positions.filter((p) => Number(p.receivable_inr) !== 0) });
  }
  const { rows, total } = await listVouchers(s, {
    from: qDate(req, "from"), to: qDate(req, "to"), type: "RECEIPT", q: qStr(req, "q") ?? null, ...page(req),
  });
  return json({ receipts: rows, total });
});

/**
 * POST /api/v1/receipts — take rupees from a client.
 * More than they owe is refused unless `allowAdvance` is true, because it is usually a typo.
 */
export const POST = withApi(async (req, s) => {
  await requirePermissionApi(s, "voucher.create");
  const posted = await postReceipt(s, await readJson<ReceiptInput>(req));
  return json(posted, posted.duplicate ? 200 : 201);
});
