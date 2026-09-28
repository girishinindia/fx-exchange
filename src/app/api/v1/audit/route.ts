import { json, page, qInt, qStr, withApi } from "@/lib/api";
import { listAudit } from "@/server/services/admin";

export const dynamic = "force-dynamic";

/** GET /api/v1/audit?table=&op=&user=&record=&from=&to=&limit=&offset= — the audit trail, newest first (needs audit.view). */
export const GET = withApi(async (req, s) => {
  const r = await listAudit(s, {
    table: qStr(req, "table") ?? null,
    op: qStr(req, "op")?.toUpperCase() ?? null,
    user: qInt(req, "user") ?? null,
    record: qInt(req, "record") ?? null,
    from: qStr(req, "from") ?? null,
    to: qStr(req, "to") ?? null,
    ...page(req),
  });
  return json({ entries: r.rows, hasMore: r.hasMore, tables: r.tables, users: r.users });
});
