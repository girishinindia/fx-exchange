import type { Metadata } from "next";
import Link from "next/link";
import { Card, Icon, LinkButton, Note, PageHeader } from "@/components/ui";
import { getCompanyInfo } from "@/lib/company";
import { fmtDate, fyStartISO, todayISO } from "@/lib/format";
import { formatINR, formatQty } from "@/lib/money";
import { getPermissions } from "@/lib/permissions";
import { requireSession } from "@/lib/session";
import { currencyDue } from "@/server/services/deals";
import { listVouchers } from "@/server/services/ledger";

export const metadata: Metadata = { title: "Currency payouts" };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function PayoutsPage({ searchParams }: PageProps<"/payouts">) {
  const s = await requireSession();
  if (s.preview) return <Note tone="amber">Needs a real login.</Note>;
  const perms = await getPermissions(s);
  if (!perms.has("voucher.view")) return <Note tone="rose">You do not have permission to see payouts.</Note>;

  const company = await getCompanyInfo(s);
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const from = DATE.test(one("from")) ? one("from") : fyStartISO(company.fiscalYearStartMonth);
  const to = DATE.test(one("to")) ? one("to") : todayISO();

  const { rows, total } = await listVouchers(s, { from, to, type: "PAYOUT", limit: 100 });
  const due = perms.has("report.view") ? await currencyDue(s) : [];
  const owedValue = due.reduce((a, d) => a + Number(d.inr_value), 0);
  const paid = rows.reduce((a, r) => a + Number(r.total_inr), 0);
  const sel = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm";

  return (
    <>
      <PageHeader
        title="Currency payouts"
        crumbs={["Daily work"]}
        subtitle="Handing clients the currency a deal promised them. All at once or in parts — the balance stays on their ledger either way."
        actions={perms.has("voucher.create") && due.length > 0 && <LinkButton href="/payouts/new" icon="fa-plus">Hand currency over</LinkButton>}
      />

      {due.length > 0 ? (
        <Card title={`Waiting to be delivered — ${formatINR(owedValue, { decimals: 0 })} across ${due.length} client${due.length > 1 ? "s" : ""} and currenc${due.length > 1 ? "ies" : "y"}`} icon="fa-hourglass-half">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {due.map((d) => (
              <div key={`${d.party_id}-${d.currency_code}`} className="rounded-xl border border-sky-100 px-4 py-3">
                <Link href={`/parties/${d.party_id}`} className="font-medium text-slate-800 hover:underline">{d.full_name}</Link>
                <div className="mt-1 text-xl font-semibold tabular-nums text-slate-800">{formatQty(d.fx_due)} {d.currency_code}</div>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>booked at {formatINR(d.inr_value, { decimals: 0 })}</span>
                  {perms.has("voucher.create") && (
                    <Link href={`/payouts/new?due=${d.party_id}:${d.currency_code}`} className="font-medium text-sky-700 hover:underline">Hand over</Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <Note tone="emerald" icon="fa-circle-check">Every client has been given the currency they were promised.</Note>
      )}

      <Card title="Delivered" icon="fa-money-bill-transfer"
        actions={
          <form className="flex items-end gap-2">
            <label className="block w-32"><span className="text-xs font-medium text-slate-500">From</span><input type="date" name="from" defaultValue={from} className={sel} /></label>
            <label className="block w-32"><span className="text-xs font-medium text-slate-500">To</span><input type="date" name="to" defaultValue={to} className={sel} /></label>
            <button className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700">Apply</button>
          </form>
        }>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>{["Voucher", "Date", "Client", "Reference", "Value (₹)"].map((h, i) => (
                <th key={h} className={`px-3 py-2 font-semibold ${i === 4 ? "text-right" : "text-left"}`}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-sky-50 hover:bg-sky-50/40">
                  <td className="px-3 py-2"><Link href={`/vouchers/${r.id}`} className="font-medium text-sky-700 hover:underline">{r.voucher_no}</Link></td>
                  <td className="px-3 py-2 text-slate-600">{fmtDate(r.voucher_date)}</td>
                  <td className="px-3 py-2">{r.party_name ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-500">{r.reference_no ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatINR(r.total_inr)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-10 text-center text-slate-500">
                  <Icon name="fa-money-bill-transfer" className="mr-2 text-slate-300" />No payout in this period.
                </td></tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="border-t border-sky-100 bg-sky-50/70 font-semibold">
                <tr><td colSpan={4} className="px-3 py-2 text-right text-slate-600">{total} payout{total === 1 ? "" : "s"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatINR(paid)}</td></tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
    </>
  );
}
