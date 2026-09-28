import { apiError, json, readJson, withApi } from "@/lib/api";
import { updateCurrency } from "@/server/services/admin";

export const dynamic = "force-dynamic";

/** PATCH /api/v1/currencies/{id} { order, active } — display order and whether it can be dealt. */
export const PATCH = withApi(async (req, s, ctx) => {
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return apiError("invalid", "Bad currency id.", 400);
  const body = await readJson<{ order?: number; active?: boolean }>(req);
  if (typeof body.order !== "number" || typeof body.active !== "boolean") return apiError("invalid", "order (number) and active (boolean) are required.", 400);
  return json(await updateCurrency(s, { id: Number(id), order: body.order, active: body.active }));
});
