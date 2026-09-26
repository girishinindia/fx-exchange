import type { Metadata } from "next";
import { Card, Icon, Note, PageHeader } from "@/components/ui";
import { withTenant } from "@/lib/db";
import { fmtShort } from "@/lib/format";
import { requirePermission } from "@/lib/permissions";
import { tenantOf } from "@/lib/session";
import { BackupForm } from "./BackupForm";

export const metadata: Metadata = { title: "Backup" };

type Log = { id: string; created_at: Date; file_name: string; include_audit: boolean; table_count: number; row_count: string; by_name: string | null };

export default async function BackupPage() {
  const s = await requirePermission("backup.manage");
  if (s.preview) return <Note tone="amber">Needs a real login.</Note>;
  const { logs, lastDays } = await withTenant(await tenantOf(s), async (tx) => {
    const logs = await tx<Log[]>`
      select b.id, b.created_at, b.file_name, b.include_audit, b.table_count, b.row_count::text, u.full_name as by_name
        from ex.backup_log b left join ex.app_user u on u.id = b.created_by
       order by b.created_at desc limit 20`;
    const [{ d }] = await tx<{ d: number | null }[]>`select (ex.fn_company_today() - max(created_at)::date)::int as d from ex.backup_log`;
    return { logs, lastDays: d };
  });

  return (
    <>
      <PageHeader title="Backup" crumbs={["Administration"]} subtitle="Download a complete copy of your company's data, and see who downloaded one." />
      {lastDays === null ? (
        <Note tone="amber" icon="fa-triangle-exclamation">No company backup has been downloaded yet.</Note>
      ) : lastDays > 7 ? (
        <Note tone="amber" icon="fa-triangle-exclamation">The last company backup is {lastDays} days old. Download one at least once a week.</Note>
      ) : null}
      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <Card title="Company backup" icon="fa-box-archive">
          <p className="text-sm text-slate-600 mb-4">
            One ZIP file with every table of your company as CSV (opens in Excel) and JSON (exact values), today&apos;s stock, customer and cash
            balances, and a checksum list. All files are taken at the same instant. Password hashes are never included.
          </p>
          <BackupForm />
          <p className="mt-4 text-xs text-slate-500"><Icon name="fa-lock" className="mr-1" />The file holds customer names, ID numbers and every transaction. Store it on an encrypted drive, never in email or chat.</p>
        </Card>
        <Card title="Automatic database backups" icon="fa-shield-halved">
          <ul className="space-y-2 text-sm text-slate-600">
            <li className="flex gap-2"><Icon name="fa-circle-check" className="text-emerald-600 mt-0.5" />Supabase keeps a daily backup of the whole database. With Point-in-Time Recovery it can be restored to any second in the retention window.</li>
            <li className="flex gap-2"><Icon name="fa-circle-check" className="text-emerald-600 mt-0.5" />The ZIP here is your own off-site copy — keep one per week (or before month-end closing).</li>
            <li className="flex gap-2"><Icon name="fa-circle-check" className="text-emerald-600 mt-0.5" /><span>Check a ZIP is complete with <code className="text-xs bg-slate-100 px-1 rounded">npm run backup:verify -- file.zip</code>. The restore steps are in <code className="text-xs bg-slate-100 px-1 rounded">docs/RESTORE.md</code>.</span></li>
          </ul>
        </Card>
      </div>
      <Card title="Backup history" icon="fa-clock-rotate-left" padded={false}>
        <table className="w-full text-sm whitespace-nowrap">
          <thead className="bg-sky-50/70">
            <tr>{["When", "File", "Tables", "Rows", "Audit log", "By"].map((h, i) => <th key={h} className={`px-4 py-2.5 text-xs font-semibold uppercase text-slate-500 ${[2, 3].includes(i) ? "text-right" : "text-left"}`}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {logs.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No backups yet.</td></tr>}
            {logs.map((l) => (
              <tr key={l.id} className="border-t border-sky-50">
                <td className="px-4 py-2.5 text-slate-600">{fmtShort(l.created_at)}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{l.file_name}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{l.table_count}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{Number(l.row_count).toLocaleString("en-IN")}</td>
                <td className="px-4 py-2.5">{l.include_audit ? "Included" : "—"}</td>
                <td className="px-4 py-2.5 text-slate-600">{l.by_name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
