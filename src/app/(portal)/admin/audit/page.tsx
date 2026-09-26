import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, Note, PageHeader } from "@/components/ui";
import { withTenant } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { requirePermission } from "@/lib/permissions";
import { tenantOf } from "@/lib/session";

export const metadata: Metadata = { title: "Audit log" };

const PAGE = 50;

/**
 * The Table filter offers what is actually in this company's log, read from the log itself.
 *
 * It used to be a hand-written list, and by Phase 7 it was a list of the retail counter:
 * thirteen of its nineteen entries named tables that had been dropped — exchange_txn,
 * currency_holding, business_day, customer_rate — and it offered none of voucher, voucher_line,
 * deposit, deal or party, which is everything a ledger product is actually asked about. Reading
 * `distinct table_name` costs one indexed scan and cannot go stale: a table that is audited
 * appears the first time somebody changes a row in it, and one that is dropped stops appearing
 * on its own.
 */

type AuditRow = {
  id: string; changed_at: Date; operation: "INSERT" | "UPDATE" | "DELETE"; table_name: string; record_id: string | null;
  changed_fields: Record<string, { old: unknown; new: unknown }> | null; new_data: Record<string, unknown> | null; old_data: Record<string, unknown> | null;
  user_name: string | null; client_ip: string | null; app_context: string | null;
};

const opTone = { INSERT: "emerald", UPDATE: "amber", DELETE: "rose" } as const;
const HIDDEN = new Set(["company_id", "created_at", "created_by", "updated_at", "updated_by", "row_version", "id"]);

function show(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return v.length > 60 ? v.slice(0, 57) + "…" : v;
  return JSON.stringify(v);
}

function Change({ r }: { r: AuditRow }) {
  if (r.operation === "UPDATE" && r.changed_fields) {
    return (
      <div className="space-y-0.5 font-mono text-xs">
        {Object.entries(r.changed_fields).map(([k, v]) => (
          <div key={k}>
            <span className="text-slate-500">{k}:</span> <s className="text-rose-600">{show(v.old)}</s> → <b className="text-emerald-700">{show(v.new)}</b>
          </div>
        ))}
      </div>
    );
  }
  const data = r.new_data ?? r.old_data ?? {};
  const summary = Object.entries(data).filter(([k, v]) => !HIDDEN.has(k) && v !== null).slice(0, 4);
  return <div className="text-xs text-slate-600">{summary.map(([k, v]) => `${k}: ${show(v)}`).join(" · ")}</div>;
}

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  const s = await requirePermission("audit.view");
  if (s.preview) return <Note tone="amber">The audit log needs a real login (not available in preview).</Note>;
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const f = { table: one("table"), op: one("op"), user: one("user"), from: one("from"), to: one("to"), record: one("record") };
  const page = Math.max(1, Number(one("page")) || 1);

  const op = ["INSERT", "UPDATE", "DELETE"].includes(f.op) ? f.op : null;
  const user = /^\d+$/.test(f.user) ? Number(f.user) : null;
  const record = /^\d+$/.test(f.record) ? Number(f.record) : null;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(f.from) ? f.from : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(f.to) ? f.to : null;

  const { rows, users, tables, table } = await withTenant(await tenantOf(s), async (tx) => {
    const tables = (await tx<{ table_name: string }[]>`
      select distinct table_name from ex.audit_log order by table_name`).map((t) => t.table_name);
    // An unknown or stale table in the URL falls back to "All", rather than an empty page.
    const table = tables.includes(f.table) ? f.table : null;
    const rows = await tx<AuditRow[]>`
      select a.id, a.changed_at, a.operation, a.table_name, a.record_id, a.changed_fields, a.new_data, a.old_data,
             u.full_name as user_name, a.client_ip, a.app_context
        from ex.audit_log a
        left join ex.app_user u on u.id = a.changed_by
       where (${table}::text is null or a.table_name = ${table})
         and (${op}::text is null or a.operation = ${op})
         and (${user}::bigint is null or a.changed_by = ${user})
         and (${record}::bigint is null or a.record_id = ${record})
         and (${from}::date is null or a.changed_at >= (${from}::date)::timestamp at time zone 'Asia/Kolkata')
         and (${to}::date is null or a.changed_at < ((${to}::date) + 1)::timestamp at time zone 'Asia/Kolkata')
       order by a.id desc
       limit ${PAGE + 1} offset ${(page - 1) * PAGE}`;
    const users = await tx<{ id: string; full_name: string }[]>`select id, full_name from ex.app_user order by full_name`;
    return { rows, users, tables, table };
  });
  const hasNext = rows.length > PAGE;
  const list = rows.slice(0, PAGE);
  const qs = (p: number) => "?" + new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), page: String(p) }).toString();

  const sel = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm";
  return (
    <>
      <PageHeader title="Audit log" crumbs={["Administration"]} subtitle="Every insert, update and delete — with old and new values. Written by the database; nobody can edit or delete it." />
      <Card>
        <form className="flex flex-wrap items-end gap-3">
          <label className="block w-44"><span className="text-xs font-medium text-slate-500">Table</span>
            <select name="table" defaultValue={table ?? ""} className={sel}><option value="">All</option>{tables.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="block w-32"><span className="text-xs font-medium text-slate-500">Action</span>
            <select name="op" defaultValue={f.op} className={sel}><option value="">All</option><option>INSERT</option><option>UPDATE</option><option>DELETE</option></select></label>
          <label className="block w-44"><span className="text-xs font-medium text-slate-500">User</span>
            <select name="user" defaultValue={f.user} className={sel}><option value="">All</option>{users.map((u) => <option key={u.id} value={String(u.id)}>{u.full_name}</option>)}</select></label>
          <label className="block w-36"><span className="text-xs font-medium text-slate-500">From</span><input type="date" name="from" defaultValue={f.from} className={sel} /></label>
          <label className="block w-36"><span className="text-xs font-medium text-slate-500">To</span><input type="date" name="to" defaultValue={f.to} className={sel} /></label>
          <label className="block w-28"><span className="text-xs font-medium text-slate-500">Record id</span><input name="record" defaultValue={f.record} className={sel} /></label>
          <button className="rounded-lg bg-sky-600 text-white px-3.5 py-2 text-sm font-medium">Apply</button>
          <Link href="/admin/audit" className="text-sm text-sky-700 px-2 py-2">Reset</Link>
        </form>
      </Card>
      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-sky-50/70">
              <tr>{["When", "User", "Action", "Table", "Record", "Change", "Source"].map((h) => <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">{h}</th>)}</tr>
            </thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">No audit entries for this filter.</td></tr>}
              {list.map((r) => (
                <tr key={r.id} className="border-t border-sky-50 align-top hover:bg-sky-50/40">
                  <td className="px-4 py-3 whitespace-nowrap">{fmtDateTime(r.changed_at)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{r.user_name ?? <span className="text-slate-400">system</span>}</td>
                  <td className="px-4 py-3"><Badge tone={opTone[r.operation]}>{r.operation}</Badge></td>
                  <td className="px-4 py-3 font-mono text-xs">{r.table_name}</td>
                  <td className="px-4 py-3">#{r.record_id}</td>
                  <td className="px-4 py-3 max-w-xl">
                    <Change r={r} />
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer text-sky-700">Full row</summary>
                      <pre className="mt-1 max-h-64 overflow-auto rounded bg-slate-900 text-slate-100 p-2">{JSON.stringify(r.new_data ?? r.old_data, null, 2)}</pre>
                    </details>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{r.app_context ?? "—"} · {r.client_ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center px-4 py-3 border-t border-sky-100 text-sm text-slate-500">
          Page {page}
          <div className="ml-auto flex gap-2">
            {page > 1 && <Link className="px-3 py-1 rounded border border-sky-100" href={qs(page - 1)}>‹ Newer</Link>}
            {hasNext && <Link className="px-3 py-1 rounded border border-sky-100" href={qs(page + 1)}>Older ›</Link>}
          </div>
        </div>
      </Card>
    </>
  );
}
