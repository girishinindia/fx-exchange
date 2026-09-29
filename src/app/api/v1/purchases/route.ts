import { json, readJson, requirePermissionApi, withApi } from "@/lib/api";
import { postPurchase, type PurchaseInput } from "@/server/services/counter";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/purchases — the counter's "Buy": a deposit and, when the depositor is paid on
 * the spot, the settlement with it (`payNow: { rate }`), in ONE transaction.
 * Body: { deposit: DepositInput, payNow?: { rate, accountCode? } | null }
 */
export const POST = withApi(async (req, s) => {
  await requirePermissionApi(s, "voucher.create");
  return json(await postPurchase(s, await readJson<PurchaseInput>(req)), 201);
});
