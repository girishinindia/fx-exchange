import { json, readJson, withApi } from "@/lib/api";
import { enableCurrency, listCurrencies } from "@/server/services/admin";

export const dynamic = "force-dynamic";

/** GET /api/v1/currencies — the company's currencies and the ISO codes still available (needs currency.manage). */
export const GET = withApi(async (_req, s) => json(await listCurrencies(s)));

/** POST /api/v1/currencies { code, order? } — enable a currency; a cash/bank account is created for it. */
export const POST = withApi(async (req, s) => {
  const body = await readJson<{ code: string; order?: number }>(req);
  return json(await enableCurrency(s, { code: body.code, order: body.order ?? 10 }), 201);
});
