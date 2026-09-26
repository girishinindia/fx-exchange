import { apiError, json, readJson, requirePermissionApi, withApi } from "@/lib/api";
import { reverseVoucher } from "@/server/services/yearend";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/vouchers/{id}/reverse  { "reason": "…" }
 * Cancels a posted voucher with an equal and opposite one. The original is never edited or
 * removed — both stay in the books and together they come to nothing.
 */
export const POST = withApi(async (req, s, ctx) => {
  await requirePermissionApi(s, "voucher.reverse");
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return apiError("invalid", "The voucher id must be a number.", 400);
  const body = await readJson<{ reason?: string }>(req);
  if (!body.reason?.trim()) return apiError("invalid", "A reason is required — it stays on the record.", 400);
  return json(await reverseVoucher(s, Number(id), body.reason), 201);
});
