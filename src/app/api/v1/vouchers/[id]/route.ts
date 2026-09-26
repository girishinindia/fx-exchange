import { ApiProblem, json, withApi } from "@/lib/api";
import { getVoucher } from "@/server/services/ledger";

export const dynamic = "force-dynamic";

/** GET /api/v1/vouchers/{id} — header and every debit / credit line. */
export const GET = withApi(async (_req, s, ctx) => {
  const { id } = await ctx.params;
  const data = await getVoucher(s, Number(id));
  if (!data) throw new ApiProblem("not_found", "Voucher not found.", 404);
  return json(data);
});
