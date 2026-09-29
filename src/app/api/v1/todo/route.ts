import { json, withApi } from "@/lib/api";
import { todo } from "@/server/services/counter";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/todo — what is still open at the counter, one line per action:
 * HAND_OVER (currency a client is still to be given), COLLECT (rupees a client still owes),
 * PAY (currency a depositor is still owed, with the rate it is carried at). report.view.
 */
export const GET = withApi(async (_req, s) => json(await todo(s)));
