import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, Icon, LinkButton, Note, PageHeader } from "@/components/ui";
import { getCompanyInfo } from "@/lib/company";
import { fmtDate, fyStartISO, todayISO } from "@/lib/format";
import { formatINR, formatQty , formatRate } from "@/lib/money";
import { getPermissions } from "@/lib/permissions";
import { requireSession } from "@/lib/session";
import { depositorSummary, listDeposits } from "@/server/services/deposits";

export const metadata: Metadata = { title: "Deposits" };
const PAGE = 50;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function DepositsPage({ searchParams }: PageProps<"/deposits">) {
  const s = await requireSession();
  if (s.preview) return <Note tone="amber">Needs a real login.</Note>;
  const perms = await getPermissions(s);
  if (!perms.has("voucher.view")) return <Note tone="rose">You do not have permission to see deposits.</Note>;

  const company = await getCompanyInfo(s);
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const from = DATE.test(one("from")) ? one("from") : fyStartISO(company.fiscalYearStartMonth);
  const to = DATE.test(one("to")) ? one("to") : todayISO();
  const q = one("q").slice(0, 60) || null;
  const open = one("open") === "1";
  const page = Math.max(1, Number(one("page")) || 1);

  const { rows, total, totals } = await listDeposits(s, { from, to, q, unallocatedOnly: open, limit: PAGE, offset: (page - 1) * PAGE });
  const owed = perms.has("report.view") ? await depositorSummary(s) : [];
  const outstanding = owed.reduce((a, d) => a + Number(d.outstanding_inr), 0);

  const sel = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm";
  const qs = (extra: Record<string, string>) =>
    "?" + new URLSearchParams(Object.entries({ from, to, q: q ?? "", open: open ? "1" : "", ...extra }).filter(([, v]) => v)).toString();

  return (
    <>
      <PageHeader
        title="Deposits"
        crumbs={["Daily work"]}
        subtitle={`Currency brought in by depositors, each at the rate agreed for it. The desk deals in ${company.primaryCurrency}; the books are kept in ${company.baseCurrency}.`}
        actions={perms.has("voucher.create") && <LinkButton href="/deposits/new" icon="fa-plus">Record a deposit</LinkButton>}
      />

      <div className="grid sm:grid-cols-3 gap-4">
        <SummaryTile label={`${company.primaryCurrency} brought in`} value={`${formatQty(totals.fx)} ${company.primaryCurrency}`} sub="in the period below" icon="fa-down-long" />
        <SummaryTile label="Its value" value={formatINR(totals.inr, { decimals: 0 })} sub="at the rates agreed" icon="fa-indian-rupee-sign" />
        <SummaryTile label="Still owed to depositors" value={formatINR(outstanding, { decimals: 0 })} sub="across all time, after settlements" icon="fa-hand-holding-dollar" tone="rose" />
      </div>

      <Card>
        <form className="flex flex-wrap items-end gap-3">
          <label className="block w-36"><span className="text-xs font-medium text-slate-500">From</span><input type="date" name="from" defaultValue={from} className={sel} /></label>
          <label className="block w-36"><span className="text-xs font-medium text-slate-500">To</span><input type="date" name="to" defaultValue={to} className={sel} /></label>
          <label className="block w-56"><span className="text-xs font-medium text-slate-500">Search</span><input name="q" defaultValue={q ?? ""} placeholder="Depositor, voucher, reference" className={sel} /></label>
          <label className="flex items-center gap-2 pb-1.5 text-sm text-slate-600">
            <input type="checkbox" name="open" value="1" defaultChecked={open} className="rounded border-slate-300" />Still unspent only
          </label>
          <button className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700">Apply</button>
          <Link href="/deposits" className="text-sm text-slate-500 hover:underline">Reset</Link>
        </form>
      </Card>

      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-sky-50/70 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {["Voucher", "Date", "Depositor", "Amount", "Rate", "Value (₹)", "Still unspent", "Reference"].map((h, i) => (
                  <th key={h} className={`px-3 py-2 font-semibold ${[3, 4, 5, 6].includes(i) ? "text-right" : "text-left"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.deposit_id} className="border-t border-sky-50 hover:bg-sky-50/40">
                  <td className="px-3 py-2"><Link href={`/vouchers/${d.voucher_id}`} className="font-medium text-sky-700 hover:underline">{d.voucher_no}</Link></td>
                  <td className="px-3 py-2 text-slate-600">{fmtDate(d.deposit_date)}</td>
                  <td className="px-3 py-2"><Link href={`/parties/${d.depositor_id}`} className="text-slate-700 hover:underline">{d.depositor_name}</Link></td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatQty(d.fx_amount)} {d.currency_code.trim()}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{formatRate(d.manual_rate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatINR(d.inr_amount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {Number(d.fx_unallocated) === 0
                      ? <Badge tone="slate">fully used</Badge>
                      : <span className={Number(d.fx_allocated) > 0 ? "text-amber-700" : ""}>{formatQty(d.fx_unallocated)}</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{d.reference_no ?? "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-slate-500">
                  <Icon name="fa-down-long" className="mr-2 text-slate-300" />No deposit in this period.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        {total > PAGE && (
          <div className="flex items-center justify-between border-t border-sky-50 px-3 py-2 text-sm text-slate-600">
            <span>{(page - 1) * PAGE + 1}–{Math.min(page * PAGE, total)} of {total}</span>
            <span className="flex gap-3">
              {page > 1 && <Link href={qs({ page: String(page - 1) })} className="text-sky-700 hover:underline">Previous</Link>}
              {page * PAGE < total && <Link href={qs({ page: String(page + 1) })} className="text-sky-700 hover:underline">Next</Link>}
            </span>
          </div>
        )}
      </Card>

      {owed.length > 0 && (
        <Card title="What we owe each depositor" icon="fa-scale-unbalanced"
          actions={<Link href="/reports/depositorsummary" className="text-sm text-sky-700 hover:underline">Full summary</Link>}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Depositor</th>
                  <th className="px-3 py-2 text-right font-semibold">Brought in</th>
                  <th className="px-3 py-2 text-right font-semibold">Average rate</th>
                  <th className="px-3 py-2 text-right font-semibold">Paid back</th>
                  <th className="px-3 py-2 text-right font-semibold">Still owed</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {owed.map((d) => (
                  <tr key={d.party_id} className="border-t border-sky-50">
                    <td className="px-3 py-2"><Link href={`/parties/${d.party_id}`} className="text-slate-700 hover:underline">{d.full_name}</Link>
                      <span className="ml-2 text-xs text-slate-400">{d.party_code}</span></td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatQty(d.currency_brought_in)} {company.primaryCurrency}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{d.average_rate ? formatRate(d.average_rate) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{formatINR(d.total_settled)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{formatINR(d.outstanding_inr)}</td>
                    <td className="px-3 py-2 text-right">
                      {Number(d.outstanding_inr) > 0 && perms.has("voucher.create") && (
                        <Link href={`/settlements/new?depositor=${d.party_id}`} className="text-sm font-medium text-sky-700 hover:underline">Settle</Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function SummaryTile({ label, value, sub, icon, tone = "sky" }: { label: string; value: string; sub: string; icon: string; tone?: "sky" | "rose" }) {
  return (
    <div className="rounded-xl border border-sky-100 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        <Icon name={icon} className={tone === "rose" ? "text-rose-500" : "text-sky-500"} />{label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-800">{value}</div>
      <div className="text-xs text-slate-500">{sub}</div>
    </div>
  );
}
