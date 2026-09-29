import { json, readJson, requirePermissionApi, withApi } from "@/lib/api";
import { postSale, type SaleInput } from "@/server/services/counter";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/sales — the counter's "Sell": a deal and, when the client settles on the spot,
 * the hand-over (`handOver: {}`) and the receipt (`collect: {}`) with it, in ONE transaction.
 * Body: { deal: DealInput, handOver?: { accountCode? } | null, collect?: { inrAmount?, accountCode?, allowAdvance? } | null }
 * All or nothing: a refusal anywhere posts nothing. deal.manage; the follow-ups need voucher.create.
 */
export const POST = withApi(async (req, s) => {
  await requirePermissionApi(s, "deal.manage");
  const body = await readJson<SaleInput>(req);
  if (body.handOver || body.collect) await requirePermissionApi(s, "voucher.create");
  return json(await postSale(s, body), 201);
});
