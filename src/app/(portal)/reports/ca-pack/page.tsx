import type { Metadata } from "next";
import Link from "next/link";
import { Card, Icon, LinkButton, Note, PageHeader } from "@/components/ui";
import { getCompanyInfo } from "@/lib/company";
import { fmtDate, fyStartISO, todayISO } from "@/lib/format";
import { formatINR } from "@/lib/money";
import { getPermissions } from "@/lib/permissions";
import { runReport } from "@/lib/report-access";
import { CA_PACK, REPORTS } from "@/lib/reports";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Pack for the CA" };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Everything the accountant asks for at filing time, gathered on one page: the books balance,
 * the year's profit, the position on the closing date, who owes what and how old it is, and
 * the entries behind all of it. Printed together or downloaded as one workbook, a sheet each.
 */
export default async function CaPackPage({ searchParams }: PageProps<"/reports/ca-pack">) {
  const s = await requireSession();
  if (s.preview) return <Note tone="amber">Needs a real login.</Note>;
  const perms = await getPermissions(s);
  if (!perms.has("report.view")) return <Note tone="rose">You do not have permission to see reports.</Note>;

  const company = await getCompanyInfo(s);
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const from = DATE.test(one("from")) ? one("from") : fyStartISO(company.fiscalYearStartMonth);
  const to = DATE.test(one("to")) ? one("to") : todayISO();
  const qs = new URLSearchParams({ from, to }).toString();

  // the three numbers the CA checks before reading anything else
  const [tb, pl, bs] = await Promise.all([
    runReport(s, "trialbalance", { from, to }),
    runReport(s, "profitloss", { from, to }),
    runReport(s, "balancesheet", { from, to }),
  ]);
  const balanced = tb?.result?.totals?.debit === tb?.result?.totals?.credit;
  const profit = pl?.result?.totals?.amount ?? "0.00";
  const sheetOk = (bs?.result?.note ?? "").startsWith("What the company holds");
  const sel = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm";
  const canExport = perms.has("export.data");

  return (
    <>
      <PageHeader
        title="Pack for the CA"
        crumbs={["Reports"]}
        subtitle={`Everything needed at filing time, for ${fmtDate(from)} to ${fmtDate(to)}.`}
        actions={canExport && (
          <span className="flex flex-wrap gap-2">
            <LinkButton href={`/print/ca-pack?${qs}`} icon="fa-print" variant="ghost">Print</LinkButton>
            <LinkButton href={`/api/export/ca-pack?${qs}&format=xlsx`} icon="fa-file-excel">Download the workbook</LinkButton>
          </span>
        )}
      />

      <Card>
        <form className="flex flex-wrap items-end gap-3">
          <label className="block w-40"><span className="text-xs font-medium text-slate-500">Year from</span><input type="date" name="from" defaultValue={from} className={sel} /></label>
          <label className="block w-40"><span className="text-xs font-medium text-slate-500">to</span><input type="date" name="to" defaultValue={to} className={sel} /></label>
          <button className="rounded-lg bg-sky-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-sky-700"><Icon name="fa-filter" className="mr-1" />Apply</button>
          <Link href="/reports/ca-pack" className="text-sm text-slate-500 hover:underline">This financial year</Link>
        </form>
      </Card>

      <div className="grid sm:grid-cols-3 gap-4">
        <Check ok={balanced} label="The books balance"
          value={balanced ? formatINR(tb?.result?.totals?.debit ?? 0, { decimals: 0 }) : "Out of balance"}
          sub={balanced ? "debits equal credits" : "check the latest vouchers"} />
        <Check ok={Number(profit) >= 0} label={Number(profit) < 0 ? "Loss for the period" : "Profit for the period"}
          value={formatINR(Math.abs(Number(profit)), { decimals: 0 })} sub="earned minus spent" neutral />
        <Check ok={sheetOk} label="Balance sheet"
          value={sheetOk ? "Square" : "Out of balance"}
          sub={sheetOk ? "holdings equal what is owed plus own funds" : "check the latest vouchers"} />
      </div>

      {!balanced && (
        <Note tone="rose" icon="fa-circle-exclamation">
          The trial balance does not agree. Nothing should be filed from this pack until it does —
          open the <Link href={`/reports/trialbalance?${qs}`} className="underline font-medium">trial balance</Link> and look at the most recent vouchers.
        </Note>
      )}

      <Card title="What is in the pack" icon="fa-folder-open" padded={false}>
        <ol className="divide-y divide-sky-50">
          {CA_PACK.map((key, i) => {
            const def = REPORTS[key];
            return (
              <li key={key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-50 text-xs font-semibold text-sky-700">{i + 1}</span>
                <Icon name={def.icon} className="text-sky-500" />
                <span className="min-w-[10rem] font-medium text-slate-800">{def.title}</span>
                <span className="flex-1 text-sm text-slate-500">{def.description}</span>
                <Link href={`/reports/${key}?${qs}`} className="text-sm font-medium text-sky-700 hover:underline">Open</Link>
              </li>
            );
          })}
        </ol>
      </Card>

      <p className="text-xs text-slate-500">
        <Icon name="fa-circle-info" className="mr-1" />
        The workbook has one sheet per statement, with real numbers rather than text — your CA can total and
        filter them directly. Every voucher number in it is gapless and every posted entry is unchangeable,
        so the pack and the ledger can never disagree.
      </p>
    </>
  );
}

function Check({ ok, label, value, sub, neutral }: { ok: boolean; label: string; value: string; sub: string; neutral?: boolean }) {
  const tone = neutral ? "border-sky-100" : ok ? "border-emerald-200 bg-emerald-50/40" : "border-rose-200 bg-rose-50/50";
  const icon = neutral ? "fa-coins" : ok ? "fa-circle-check" : "fa-circle-exclamation";
  const colour = neutral ? "text-sky-500" : ok ? "text-emerald-600" : "text-rose-600";
  return (
    <div className={`rounded-xl border bg-white px-4 py-3 shadow-sm ${tone}`}>
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        <Icon name={icon} className={colour} />{label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-800">{value}</div>
      <div className="text-xs text-slate-500">{sub}</div>
    </div>
  );
}
