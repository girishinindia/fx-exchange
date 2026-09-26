import { apiError, json, withApi } from "@/lib/api";
import { getDeal } from "@/server/services/deals";

export const dynamic = "force-dynamic";

/** GET /api/v1/deals/{id} — one deal with the deposits that funded it. */
export const GET = withApi(async (_req, s, ctx) => {
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return apiError("invalid", "The deal id must be a number.", 400);
  const found = await getDeal(s, Number(id));
  if (!found) return apiError("not_found", "No such deal.", 404);
  return json(found);
});
