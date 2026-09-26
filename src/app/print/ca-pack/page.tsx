import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReportTable } from "@/components/ReportTable";
import { AutoPrint, PrintButton } from "@/components/print/AutoPrint";
import { getCompanyInfo } from "@/lib/company";
import { withTenant } from "@/lib/db";
import { fmtDate, fmtDateTime, fyStartISO, todayISO } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import { periodLabel, runReport } from "@/lib/report-access";
import { CA_PACK, REPORTS, type ReportResult } from "@/lib/reports";
import { requireSession, tenantOf } from "@/lib/session";

export const metadata: Metadata = { title: "Pack for the CA" };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The whole pack as one printable document — a cover page, then a statement per page. */
export default async function PrintCaPack({ searchParams }: PageProps<"/print/ca-pack">) {
  const s = await requireSession();
  if (!(await hasPermission(s, "export.data"))) notFound();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const company = await getCompanyInfo(s);
  const from = DATE.test(one("from")) ? one("from") : fyStartISO(company.fiscalYearStartMonth);
  const to = DATE.test(one("to")) ? one("to") : todayISO();

  const [co] = await withTenant(await tenantOf(s), (tx) =>
    tx<{ name: string; address: string | null; city: string | null; gstin: string | null }[]>`
      select coalesce(display_name, legal_name) as name, address, city, gstin from ex.company`);

  const sheets: { title: string; subtitle: string; result: ReportResult }[] = [];
  for (const key of CA_PACK) {
    const run = await runReport(s, key, { from, to });
    if (!run || !run.access.ok || !run.result) continue;
    sheets.push({ title: run.def.title, subtitle: periodLabel(run.def, run.params!), result: run.result });
  }
  if (sheets.length === 0) notFound();

  return (
    <div className="min-h-dvh bg-sky-50 p-6 print:bg-white print:p-0">
      <style>{`@page { size: A4 landscape; margin: 12mm; } @media print { .page-break { break-before: page; } }`}</style>
      <AutoPrint />
      <div className="no-print max-w-6xl mx-auto mb-4 flex"><PrintButton /></div>

      <div className="max-w-6xl mx-auto bg-white rounded-xl border border-sky-100 p-8 print:border-0 print:p-0 print:max-w-none">
        <div className="border-b border-slate-200 pb-4 mb-6">
          <div className="text-2xl font-bold">{co.name}</div>
          <div className="text-xs text-slate-500">
            {[co.address, co.city].filter(Boolean).join(", ")}{co.gstin ? ` · GSTIN ${co.gstin}` : ""}
          </div>
          <div className="mt-4 text-lg font-semibold">Statements for {fmtDate(from)} to {fmtDate(to)}</div>
          <ol className="mt-3 grid sm:grid-cols-2 gap-x-8 text-sm text-slate-600">
            {sheets.map((sh, i) => (
              <li key={sh.title} className="flex gap-2 py-0.5"><span className="text-slate-400">{i + 1}.</span>{sh.title}</li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-slate-500">
            Books kept in {company.baseCurrency}; the desk deals in {company.primaryCurrency}. Every voucher number is gapless
            within its financial year, and no posted entry can be edited or deleted — corrections appear as reversals.
          </p>
        </div>

        {sheets.map((sh, i) => (
          <section key={sh.title} className={i > 0 ? "page-break pt-6" : ""}>
            <div className="flex items-baseline justify-between border-b border-slate-200 pb-2 mb-3">
              <h2 className="font-semibold">{i + 1}. {sh.title}</h2>
              <span className="text-xs text-slate-500">{sh.subtitle}</span>
            </div>
            <ReportTable r={sh.result} dense />
            {sh.result.note && <p className="mt-2 text-xs text-slate-500">{sh.result.note}</p>}
          </section>
        ))}

        <p className="mt-8 text-[10px] text-slate-400">
          Printed {fmtDateTime(new Date())} by {s.userName} · FX Desk · {REPORTS[CA_PACK[0]].title} first
        </p>
      </div>
    </div>
  );
}
