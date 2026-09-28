import { apiError, json, requirePermissionApi, withApi } from "@/lib/api";
import { checkRate } from "@/lib/ratelimit";
import { backupStream, listBackups } from "@/server/services/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET /api/v1/backup — who downloaded a backup, and when (needs backup.manage). */
export const GET = withApi(async (_req, s) => json(await listBackups(s)));

/**
 * POST /api/v1/backup?includeAudit=1 — the company backup as a ZIP (bearer-authenticated twin of
 * /api/backup). The phone saves it where the user chooses; nothing is uploaded to us.
 */
export const POST = withApi(async (req, s) => {
  await requirePermissionApi(s, "backup.manage");
  const rl = await checkRate("backup", s.companyId, s.userId);
  if (!rl.ok) return apiError("rate_limited", `Too many backups. Try again in ${Math.ceil(rl.retryAfterSec / 60)} min.`, 429, { retryAfter: rl.retryAfterSec });
  const includeAudit = req.nextUrl.searchParams.get("includeAudit") === "1";
  const { fileName, stream } = await backupStream(s, includeAudit);
  return new Response(stream, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
