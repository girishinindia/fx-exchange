import type { Metadata } from "next";
import Link from "next/link";
import { Icon, Note, PageHeader } from "@/components/ui";
import { reportAccess } from "@/lib/report-access";
import { REPORTS } from "@/lib/reports";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Reports" };

const GROUPS = ["Accounts", "Parties", "Registers"] as const;

export default async function ReportsPage() {
  const s = await requireSession();
  if (s.preview) return <Note tone="amber">Needs a real login.</Note>;
  const entries = await Promise.all(
    Object.entries(REPORTS)
      .filter(([, d]) => !d.hidden)
      .map(async ([k, d]) => ({ k, d, access: await reportAccess(s, d) })),
  );
  const visible = entries.filter((e) => e.access.ok);

  return (
    <>
      <PageHeader title="Reports" crumbs={["Reports"]} subtitle="Ledgers and summaries for the desk, the owner and the CA. Every report exports to Excel, CSV or PDF." />
      {visible.length === 0 && <Note tone="amber">You do not have permission to view reports.</Note>}
      {visible.length > 0 && (
        <Link href="/reports/ca-pack"
          className="group block rounded-xl border border-sky-200 bg-gradient-to-r from-sky-50 to-white p-5 shadow-card hover:border-sky-300 hover:shadow-md transition">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 shrink-0 rounded-lg bg-sky-600 text-white grid place-items-center"><Icon name="fa-folder-open" /></div>
            <div className="min-w-0">
              <div className="font-semibold text-slate-900 group-hover:text-sky-700">Pack for the CA</div>
              <p className="text-sm text-slate-600 mt-0.5">
                The year&rsquo;s statements in the order an accountant reads them — trial balance, profit &amp; loss,
                balance sheet, position, who owes what and how old it is, and the entries behind it.
                Print it or download one workbook with a sheet each.
              </p>
            </div>
          </div>
        </Link>
      )}
      {visible.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Link href="/reports/day-close" className="group block rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-white p-5 shadow-card transition hover:border-amber-300 hover:shadow-md">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-amber-600 text-white"><Icon name="fa-moon" /></div>
              <div className="min-w-0">
                <div className="font-semibold text-slate-900 group-hover:text-amber-700">Day close</div>
                <p className="mt-0.5 text-sm text-slate-600">Type today&rsquo;s closing rates, see the stock valued, the rupee drawers and the day&rsquo;s result. Nothing is posted; no rate is kept.</p>
              </div>
            </div>
          </Link>
          <Link href="/entry" className="group block rounded-xl border border-sky-100 bg-white p-5 shadow-card transition hover:border-sky-300 hover:shadow-md">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-sky-50 text-sky-600"><Icon name="fa-table-cells" /></div>
              <div className="min-w-0">
                <div className="font-semibold text-slate-900 group-hover:text-sky-700">The board — any day</div>
                <p className="mt-0.5 text-sm text-slate-500">The day sheet: every drawer as a column, every line as a row, opening on top and closing underneath. Pick a date on it to read a past day.</p>
              </div>
            </div>
          </Link>
        </div>
      )}
      {GROUPS.map((g) => {
        const list = visible.filter((e) => e.d.group === g);
        if (!list.length) return null;
        return (
          <section key={g}>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">{g}</h2>
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {list.map(({ k, d }) => (
                <Link key={k} href={`/reports/${k}`} className="group bg-white rounded-xl border border-sky-100 shadow-card p-5 hover:border-sky-300 hover:shadow-md transition">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 shrink-0 rounded-lg bg-sky-50 text-sky-600 grid place-items-center"><Icon name={d.icon} /></div>
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 group-hover:text-sky-700">{d.title}</div>
                      <p className="text-sm text-slate-500 mt-0.5">{d.description}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
