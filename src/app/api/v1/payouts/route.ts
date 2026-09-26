import { json, page, qDate, qInt, qStr, readJson, requirePermissionApi, withApi } from "@/lib/api";
import { postPayout, type PayoutInput } from "@/server/services/clients";
import { currencyDue } from "@/server/services/deals";
import { listVouchers } from "@/server/services/ledger";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/payouts?from=&to=&q=  — currency handed over.
 * With `outstanding=1`, returns what is still to be delivered, per client and currency.
 */
export const GET = withApi(async (req, s) => {
  if (qStr(req, "outstanding") === "1") {
    return json({ outstanding: await currencyDue(s, qInt(req, "clientId")) });
  }
  const { rows, total } = await listVouchers(s, {
    from: qDate(req, "from"), to: qDate(req, "to"), type: "PAYOUT", q: qStr(req, "q") ?? null, ...page(req),
  });
  return json({ payouts: rows, total });
});

/** POST /api/v1/payouts — hand a client the currency a deal promised them, in full or in part. */
export const POST = withApi(async (req, s) => {
  await requirePermissionApi(s, "voucher.create");
  const posted = await postPayout(s, await readJson<PayoutInput>(req));
  return json(posted, posted.duplicate ? 200 : 201);
});
