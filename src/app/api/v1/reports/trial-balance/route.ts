import { json, withApi } from "@/lib/api";
import { trialBalance } from "@/server/services/ledger";

export const dynamic = "force-dynamic";

/** GET /api/v1/reports/trial-balance */
export const GET = withApi(async (_req, s) => json(await trialBalance(s)));
