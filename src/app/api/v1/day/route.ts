import { json, qDate, withApi } from "@/lib/api";
import { daySheet } from "@/server/services/day";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/day?date=YYYY-MM-DD — the day sheet: one column per Cash/Bank account, opening,
 * one row per voucher of the day with its cells and a written remark, in / out / closing, and the
 * day's result. Today when no date is given. report.view.
 */
export const GET = withApi(async (req, s) => json(await daySheet(s, qDate(req, "date"))));
