import { json, page, qDate, qStr, readJson, withApi } from "@/lib/api";
import { VOUCHER_TYPE_LIST, type VoucherInput, type VoucherType } from "@/lib/ledger";
import { listVouchers, postVoucher } from "@/server/services/ledger";

export const dynamic = "force-dynamic";

/** GET /api/v1/vouchers?from=&to=&type=&partyId=&q=&limit=&offset= */
export const GET = withApi(async (req, s) => {
  const type = qStr(req, "type") as VoucherType | undefined;
  const partyId = qStr(req, "partyId");
  const { rows, total } = await listVouchers(s, {
    from: qDate(req, "from"),
    to: qDate(req, "to"),
    type: type && VOUCHER_TYPE_LIST.includes(type) ? type : null,
    partyId: partyId ? Number(partyId) : null,
    q: qStr(req, "q") ?? null,
    ...page(req),
  });
  return json({ vouchers: rows, total });
});

/**
 * POST /api/v1/vouchers — post a voucher.
 * Send clientRef (any unique string) and a repeated call returns the same voucher
 * instead of posting twice — safe on a flaky mobile connection.
 */
export const POST = withApi(async (req, s) => {
  const body = await readJson<VoucherInput>(req);
  const posted = await postVoucher(s, body);
  return json(posted, posted.duplicate ? 200 : 201);
});
