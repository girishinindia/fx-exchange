import type { Metadata } from "next";
import Link from "next/link";
import { Card, Icon, LinkButton, Note, PageHeader } from "@/components/ui";
import { getCompanyInfo } from "@/lib/company";
import { fmtDate, fyStartISO, todayISO } from "@/lib/format";
import { formatINR, formatQty , formatRate } from "@/lib/money";
import { getPermissions } from "@/lib/permissions";
import { requireSession } from "@/lib/session";
import { currencyDue, listDeals } from "@/server/services/deals";

export const metadata: Metadata = { title: "Deals" };
const PAGE = 50;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function DealsPage({ searchParams }: PageProps<"/deals">) {
  const s = await requireSession();
  if (s.preview) return <Note tone="amber">Needs a real login.</Note>;
  const perms = await getPermissions(s);
  if (!perms.has("voucher.view")) return <Note tone="rose">You do not have permission to see deals.</Note>;

  const company = await getCompanyInfo(s);
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const from = DATE.test(one("from")) ? one("from") : fyStartISO(company.fiscalYearStartMonth);
  const to = DATE.test(one("to")) ? one("to") : todayISO();
  const q = one("q").slice(0, 60) || null;
  const page = Math.max(1, Number(one("page")) || 1);

  const { rows, total, totals } = await listDeals(s, { from, to, q, limit: PAGE, offset: (page - 1) * PAGE });
  const due = perms.has("report.view") ? await currencyDue(s) : [];
  const margin = Number(totals.margin);
  const marginPct = Number(totals.cost) > 0 ? (margin * 100) / Number(totals.cost) : 0;

  const sel = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm";
  const qs = (extra: Record<string, string>) =>
    "?" + new URLSearchParams(Object.entries({ from, to, q: q ?? "", ...extra }).filter(([, v]) => v)).toString();

  return (
    <>
      <PageHeader
        title="Deals"
        crumbs={["Daily work"]}
        subtitle={`${company.primaryCurrency} turned into the currency clients asked for. Each deal carries its own two rates and its own margin.`}
        actions={perms.has("deal.manage") && <LinkButton href="/deals/new" icon="fa-plus">Book a deal</LinkButton>}
      />

      <div className="grid sm:grid-cols-3 gap-4">
        <Tile label="Billed to clients" value={formatINR(totals.billed, { decimals: 0 })} sub="in the period below" icon="fa-file-invoice" />
        <Tile label="What it cost us" value={formatINR(totals.cost, { decimals: 0 })} sub={`${company.primaryCurrency} at the rates it came in at`} icon="fa-cart-shopping" />
        <Tile label={margin < 0 ? "Loss" : "Margin"} value={formatINR(Math.abs(margin), { decimals: 0 })}
          sub={Number(totals.cost) > 0 ? `${marginPct.toFixed(2)}% of cost` : "billing − cost"} icon="fa-coins" tone={margin < 0 ? "rose" : "emerald"} />
      </div>

      <Card>
        <form className="flex flex-wrap items-end gap-3">
          <label className="block w-36"><span className="text-xs font-medium text-slate-500">From</span><input type="date" name="from" defaultValue={from} className={sel} /></label>
          <label className="block w-36"><span className="text-xs font-medium text-slate-500">To</span><input type="date" name="to" defaultValue={to} className={sel} /></label>
          <label className="block w-56"><span className="text-xs font-medium text-slate-500">Search</span><input name="q" defaultValue={q ?? ""} placeholder="Client, voucher, reference" className={sel} /></label>
          <button className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700">Apply</button>
          <Link href="/deals" className="text-sm text-slate-500 hover:underline">Reset</Link>
        </form>
      </Card>

      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-sky-50/70 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {["Voucher", "Date", "Client", "Given", "Rate", "Billed (₹)", "Cost (₹)", "Margin (₹)", "%"].map((h, i) => (
                  <th key={h} className={`px-3 py-2 font-semibold ${i >= 3 ? "text-right" : "text-left"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const m = Number(d.margin_inr);
                return (
                  <tr key={d.deal_id} className="border-t border-sky-50 hover:bg-sky-50/40">
                    <td className="px-3 py-2"><Link href={`/deals/${d.deal_id}`} className="font-medium text-sky-700 hover:underline">{d.voucher_no}</Link></td>
                    <td className="px-3 py-2 text-slate-600">{fmtDate(d.deal_date)}</td>
                    <td className="px-3 py-2"><Link href={`/parties/${d.client_id}`} className="text-slate-700 hover:underline">{d.client_name}</Link></td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatQty(d.fx_amount)} {d.fx_currency}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{formatRate(d.fx_to_inr_rate)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatINR(d.billed_inr)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{formatINR(d.src_cost_inr)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-medium ${m < 0 ? "text-rose-700" : "text-emerald-700"}`}>{formatINR(m)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${m < 0 ? "text-rose-600" : "text-slate-500"}`}>{d.margin_pct ? `${Number(d.margin_pct).toFixed(2)}%` : "—"}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-10 text-center text-slate-500">
                  <Icon name="fa-right-left" className="mr-2 text-slate-300" />No deal in this period.
                </td></tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="border-t border-sky-100 bg-sky-50/70 font-semibold">
                <tr>
                  <td colSpan={5} className="px-3 py-2 text-right text-slate-600">{total} deal{total === 1 ? "" : "s"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatINR(totals.billed)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatINR(totals.cost)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${margin < 0 ? "text-rose-700" : "text-emerald-700"}`}>{formatINR(margin)}</td>
                  <td className="px-3 py-2" />
                </tr>
              </tfoot>
            )}
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

      {due.length > 0 && (
        <Card title="Currency still to hand over" icon="fa-hand-holding"
          actions={<Link href="/reports/currencydue" className="text-sm text-sky-700 hover:underline">Full list</Link>}>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {due.map((d) => (
              <div key={`${d.party_id}-${d.currency_code}`} className="rounded-xl border border-sky-100 px-4 py-3">
                <Link href={`/parties/${d.party_id}`} className="font-medium text-slate-800 hover:underline">{d.full_name}</Link>
                <div className="mt-1 text-xl font-semibold tabular-nums text-slate-800">{formatQty(d.fx_due)} {d.currency_code}</div>
                <div className="text-xs text-slate-500">booked at {formatINR(d.inr_value, { decimals: 0 })}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

function Tile({ label, value, sub, icon, tone = "sky" }: { label: string; value: string; sub: string; icon: string; tone?: "sky" | "rose" | "emerald" }) {
  const colour = tone === "rose" ? "text-rose-500" : tone === "emerald" ? "text-emerald-500" : "text-sky-500";
  return (
    <div className="rounded-xl border border-sky-100 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        <Icon name={icon} className={colour} />{label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-800">{value}</div>
      <div className="text-xs text-slate-500">{sub}</div>
    </div>
  );
}
