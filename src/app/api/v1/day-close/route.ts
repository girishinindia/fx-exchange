import { json, readJson, withApi } from "@/lib/api";
import { dayClose, type DayCloseInput } from "@/server/services/day";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/day-close — the day valued at the closing rates typed just now.
 * Body: { date?, rates: [{ currency, rate }] } → stock per currency at those rates, the rupee
 * drawers, the day's result. Nothing is posted and no rate is kept: restating the books is
 * POST /year-end/revalue, as before. report.view.
 */
export const POST = withApi(async (req, s) => json(await dayClose(s, await readJson<DayCloseInput>(req))));
