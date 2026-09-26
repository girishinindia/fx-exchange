import type { NextRequest } from "next/server";
import { backupTables, countRows, SCHEMA_VERSION, writeBackup } from "@/lib/backup";
import { withTenant } from "@/lib/db";
import { hasPermission } from "@/lib/permissions";
import { checkRate } from "@/lib/ratelimit";
import { getSession, tenantOf } from "@/lib/session";

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
  const tenant = await tenantOf(s);

  const [company] = await withTenant(tenant, (tx) =>
    tx<{ id: string; code: string; name: string; today: string }[]>`
      select id, code, coalesce(display_name, legal_name) as name,
             to_char(now() at time zone coalesce(timezone, 'Asia/Kolkata'), 'YYYY-MM-DD_HH24MI') as today
        from ex.company`);
  const fileName = `fx-backup_${company.code}_${company.today}${includeAudit ? "_with-audit" : ""}.zip`;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      withTenant(
        tenant,
        async (tx) => {
          const tables = backupTables(includeAudit);
          const counts = await countRows(tx, tables);
          // recorded in its own (write) transaction; the data below comes from the read-only snapshot
          await withTenant(tenant, (w) => w`select ex.fn_record_backup(${w.json({
            file_name: fileName, include_audit: includeAudit, table_count: tables.length,
            row_count: Object.values(counts).reduce((a, b) => a + b, 0), schema_version: SCHEMA_VERSION,
          })})`);
          await writeBackup(tx, { company: { id: Number(company.id), code: company.code, name: company.name }, by: { id: s.userId, name: s.userName }, includeAudit, counts }, (c) => controller.enqueue(c));
        },
        { snapshot: true },
      ).then(
        () => controller.close(),
        (e) => {
          console.error("backup failed", e);
          controller.error(e);
        },
      );
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
