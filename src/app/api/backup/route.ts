import type { NextRequest } from "next/server";
import { hasPermission } from "@/lib/permissions";
import { checkRate } from "@/lib/ratelimit";
import { getSession } from "@/lib/session";
import { backupStream } from "@/server/services/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Same-origin check for this cookie-authenticated POST (route handlers have no built-in CSRF check). */
function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** POST /api/backup (form field include_audit=1) — streams the company backup ZIP. Needs backup.manage. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return new Response("Bad origin", { status: 403 });
  const s = await getSession();
  if (!s || s.mustChangePassword || s.preview) return new Response("Sign in first", { status: 401 });
  if (!(await hasPermission(s, "backup.manage"))) return new Response("Permission denied: backup.manage", { status: 403 });
  const rl = await checkRate("backup", s.companyId, s.userId);
  if (!rl.ok) return new Response(`Too many backups. Try again in ${Math.ceil(rl.retryAfterSec / 60)} min.`, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } });

  const form = await req.formData().catch(() => null);
  const includeAudit = form?.get("include_audit") === "1";
  const { fileName, stream } = await backupStream(s, includeAudit);

  return new Response(stream, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
