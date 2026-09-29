import { json, withApi } from "@/lib/api";
import { walkIn } from "@/server/services/day";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/parties/walk-in — the company's built-in Walk-in party (a client and a depositor
 * with no account), created the first time it is asked for. deal.manage or voucher.create.
 */
export const GET = withApi(async (_req, s) => json(await walkIn(s)));
