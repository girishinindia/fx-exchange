import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BarChart } from "@/components/BarChart";
import { ExportLinks } from "@/components/ExportLinks";
import { ReportTable } from "@/components/ReportTable";
import { Card, Icon, Note, PageHeader } from "@/components/ui";
import { withTenant } from "@/lib/db";
import { getPermissions } from "@/lib/permissions";
import { periodLabel, queryString, runReport } from "@/lib/report-access";
import { REPORTS } from "@/lib/reports";
import { requireSession, tenantOf } from "@/lib/session";

export async function generateMetadata({ params }: PageProps<"/reports/[report]">): Promise<Metadata> {
  const { report } = await params;
  return { title: REPORTS[report]?.title ?? "Report" };
}

export default async function ReportPage({ params, searchParams }: PageProps<"/reports/[report]">) {
  const s = await requireSession();
  if (s.preview) return <Note tone="amber">Needs a real login.</Note>;
  const { report } = await params;
  const sp = await searchParams;
  const run = await runReport(s, report, sp);
  if (!run) notFound();
  if (!run.access.ok) redirect(`/dashboard?denied=${run.access.reason}`);
  const { def, params: p, result: r } = run;
  const perms = await getPermissions(s);
  const canExport = perms.has("export.data");
  const currencies = def.params.includes("cur")
    ? await withTenant(await tenantOf(s), (tx) => tx<{ code: string }[]>`select trim(currency_code) as code from ex.company_currency where not is_base order by display_order, currency_code`)
    : [];
  // A statement is about one party, so the picker is the report's main control, not a filter.
  const partyKind = def.params.includes("party") ? (report.startsWith("depositor") ? "DEPOSITOR" : "CLIENT") : null;  // clientstatement → CLIENT
  const parties = partyKind
    ? await withTenant(await tenantOf(s), (tx) => tx<{ id: string; full_name: string; party_code: string }[]>`
        select id, full_name, party_code from ex.party
         where is_active and (${partyKind} = 'DEPOSITOR' and is_depositor or ${partyKind} = 'CLIENT' and is_client)
         order by full_name`)
    : [];
  const sel = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm";
  const qs = queryString(p!);
  const chartData = r!.chart ? r!.rows.map((row) => ({ label: String(row[r!.chart!.label] ?? ""), value: Number(row[r!.chart!.value] ?? 0) })) : [];

  return (
    <>
      <PageHeader
        title={def.title}
        crumbs={["Reports"]}
        subtitle={`${def.description} · ${periodLabel(def, p!)}`}
        actions={canExport && <ExportLinks report={report} qs={qs} />}
      />
      {(def.params.length > 0) && (
        <Card>
          <form className="flex flex-wrap items-end gap-3">
            {def.params.includes("period") && (
              <>
                <label className="block w-36"><span className="text-xs font-medium text-slate-500">From</span><input type="date" name="from" defaultValue={p!.from} className={sel} /></label>
                <label className="block w-36"><span className="text-xs font-medium text-slate-500">To</span><input type="date" name="to" defaultValue={p!.to} className={sel} /></label>
              </>
            )}
            {def.params.includes("group") && (
              <label className="block w-40"><span className="text-xs font-medium text-slate-500">Group by</span>
                <select name="group" defaultValue={p!.group} className={sel}><option value="day">Day</option><option value="month">Month</option><option value="year">Financial year</option></select></label>
            )}
            {def.params.includes("cur") && (
              <label className="block w-28"><span className="text-xs font-medium text-slate-500">Currency</span>
                <select name="cur" defaultValue={p!.cur ?? ""} className={sel}><option value="">All</option>{currencies.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}</select></label>
            )}
            {def.params.includes("party") && (
              <label className="block w-64"><span className="text-xs font-medium text-slate-500">{partyKind === "DEPOSITOR" ? "Depositor" : "Client"}</span>
                <select name="party" defaultValue={p!.party ? String(p!.party) : ""} className={sel}>
                  <option value="">Choose…</option>
                  {parties.map((x) => <option key={x.id} value={x.id}>{x.full_name} ({x.party_code})</option>)}
                </select></label>
            )}
            {def.params.includes("q") && (
              <label className="block w-56"><span className="text-xs font-medium text-slate-500">Search</span><input name="q" defaultValue={p!.q ?? ""} placeholder="Party, account or voucher" className={sel} /></label>
            )}
            <button className="rounded-lg bg-sky-600 text-white px-3.5 py-2 text-sm font-medium"><Icon name="fa-filter" className="mr-1" />Apply</button>
            <Link href={`/reports/${report}`} className="text-sm text-sky-700 px-2 py-2">Reset</Link>
            <Link href="/reports" className="ml-auto text-sm text-slate-500 px-2 py-2"><Icon name="fa-arrow-left" /> All reports</Link>
          </form>
        </Card>
      )}
      {chartData.length > 1 && (
        <Card><BarChart data={chartData} title={r!.chart!.title} format={r!.columns.find((c) => c.key === r!.chart!.value)?.type === "pct" ? "pct" : "money"} /></Card>
      )}
      <Card padded={false}><ReportTable r={r!} /></Card>
      {r!.note && <p className="text-xs text-slate-500">{r!.note}</p>}
    </>
  );
}
