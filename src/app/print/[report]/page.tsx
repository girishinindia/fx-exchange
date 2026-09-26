import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReportTable } from "@/components/ReportTable";
import { withTenant } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import { periodLabel, runReport } from "@/lib/report-access";
import { REPORTS } from "@/lib/reports";
import { requireSession, tenantOf } from "@/lib/session";
import { AutoPrint, PrintButton } from "@/components/print/AutoPrint";

export async function generateMetadata({ params }: PageProps<"/print/[report]">): Promise<Metadata> {
  const { report } = await params;
  return { title: REPORTS[report]?.title ?? "Report" };
}

/** Print / "Save as PDF" view of a report — outside the portal layout so it prints clean (A4 landscape). */
export default async function PrintReport({ params, searchParams }: PageProps<"/print/[report]">) {
  const s = await requireSession();
  if (!(await hasPermission(s, "export.data"))) notFound();
  const { report } = await params;
  const run = await runReport(s, report, await searchParams);
  if (!run || !run.access.ok) notFound();
  const { def, params: p, result: r } = run;
  const [co] = await withTenant(await tenantOf(s), (tx) =>
    tx<{ name: string; address: string | null; city: string | null; gstin: string | null }[]>`select coalesce(display_name, legal_name) as name, address, city, gstin from ex.company`);

  return (
    <div className="min-h-dvh bg-sky-50 p-6 print:bg-white print:p-0">
      <style>{`@page { size: A4 landscape; margin: 12mm; }`}</style>
      <AutoPrint />
      <div className="no-print max-w-6xl mx-auto mb-4 flex"><PrintButton /></div>
      <div className="max-w-6xl mx-auto bg-white rounded-xl border border-sky-100 p-8 print:border-0 print:p-0 print:max-w-none">
        <div className="flex items-start border-b border-slate-200 pb-3 mb-4">
          <div>
            <div className="text-lg font-bold">{co.name}</div>
            <div className="text-xs text-slate-500">{[co.address, co.city].filter(Boolean).join(", ")}{co.gstin ? ` · GSTIN ${co.gstin}` : ""}</div>
          </div>
          <div className="ml-auto text-right">
            <div className="font-semibold">{def.title}</div>
            <div className="text-xs text-slate-500">{periodLabel(def, p!)}{false ? " · own transactions" : ""}</div>
          </div>
        </div>
        <ReportTable r={r!} dense />
        {r!.note && <p className="mt-3 text-xs text-slate-500">{r!.note}</p>}
        <p className="mt-6 text-[10px] text-slate-400">Printed {fmtDateTime(new Date())} by {s.userName} · FX Desk</p>
      </div>
    </div>
  );
}
