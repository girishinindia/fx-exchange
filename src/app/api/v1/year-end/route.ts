import { apiError, json, readJson, requirePermissionApi, withApi } from "@/lib/api";
import { listFinancialYears, lockFinancialYear, openPositions, revalue, unlockFinancialYear } from "@/server/services/yearend";

export const dynamic = "force-dynamic";

/** GET /api/v1/year-end — the financial years and the currency still open. */
export const GET = withApi(async (_req, s) => {
  const [years, positions] = await Promise.all([listFinancialYears(s), openPositions(s)]);
  return json({ financialYears: years, openPositions: positions });
});

type Body =
  | { action: "lock"; fyId: number; note?: string }
  | { action: "unlock"; fyId: number; reason: string }
  | { action: "revalue"; date?: string; narration?: string; rates: { currency: string; rate: string }[] };

/**
 * POST /api/v1/year-end — close a year, reopen one, or restate the currency at closing rates.
 * All three need fy.lock, because all three change what a filed year says.
 */
export const POST = withApi(async (req, s) => {
  await requirePermissionApi(s, "fy.lock");
  const body = await readJson<Body>(req);
  if (body.action === "lock") return json(await lockFinancialYear(s, body.fyId, body.note ?? ""));
  if (body.action === "unlock") return json(await unlockFinancialYear(s, body.fyId, body.reason));
  if (body.action === "revalue") return json(await revalue(s, body.rates, body.date, body.narration), 201);
  return apiError("invalid", "action must be lock, unlock or revalue.", 400);
});
