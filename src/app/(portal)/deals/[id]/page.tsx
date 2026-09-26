import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Icon, Kpi, LinkButton, Note, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { formatINR, formatQty , formatRate } from "@/lib/money";
import { requirePermission } from "@/lib/permissions";
import { getDeal } from "@/server/services/deals";

export const metadata: Metadata = { title: "Deal" };

export default async function DealPage({ params }: PageProps<"/deals/[id]">) {
  const s = await requirePermission("voucher.view");
  if (s.preview) return <Note tone="amber">Needs a real login.</Note>;
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const found = await getDeal(s, Number(id));
  if (!found) notFound();
  const { deal: d, funding } = found;
  const margin = Number(d.margin_inr);

  return (
    <>
      <PageHeader
        title={d.voucher_no}
        crumbs={["Daily work", "Deals"]}
        subtitle={<>{fmtDate(d.deal_date)} · <Link href={`/parties/${d.client_id}`} className="underline">{d.client_name}</Link>
          {d.status !== "POSTED" && <> · <Badge tone="rose">{d.status}</Badge></>}</>}
        actions={<LinkButton href={`/vouchers/${d.voucher_id}`} variant="ghost" icon="fa-file-lines">The voucher</LinkButton>}
      />

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Client gets" value={`${formatQty(d.fx_amount)} ${d.fx_currency}`} sub={`at ${formatRate(d.fx_to_inr_rate)} per ${d.fx_currency}`} icon="fa-arrow-right-from-bracket" tone="sky" />
        <Kpi label="Client is billed" value={formatINR(d.billed_inr, { decimals: 0 })} sub="rupees owed to us" icon="fa-file-invoice" tone="amber" />
        <Kpi label="It cost us" value={formatINR(d.src_cost_inr, { decimals: 0 })}
          sub={`${formatQty(d.src_amount)} ${d.src_currency}${d.average_cost_rate ? ` at ${formatRate(d.average_cost_rate)}` : ""}`} icon="fa-cart-shopping" tone="slate" />
        <Kpi label={margin < 0 ? "Loss" : "Margin"} value={formatINR(Math.abs(margin), { decimals: 0 })}
          sub={d.margin_pct ? `${Number(d.margin_pct).toFixed(2)}% of cost` : "billing − cost"} icon="fa-coins" tone={margin < 0 ? "rose" : "emerald"} />
      </div>

      {margin < 0 && (
        <Note tone="rose" icon="fa-arrow-trend-down">
          This deal sold below cost. {formatINR(Math.abs(margin))} sits in Exchange Loss.
        </Note>
      )}

      <Card title="Where the currency came from" icon="fa-layer-group" padded={false}
        actions={<span className="text-xs text-slate-500">Each deposit gives up its share at the rate it came in at</span>}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-sky-50/70 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Deposit</th>
                <th className="px-3 py-2 text-left font-semibold">Date</th>
                <th className="px-3 py-2 text-left font-semibold">Depositor</th>
                <th className="px-3 py-2 text-right font-semibold">Taken</th>
                <th className="px-3 py-2 text-right font-semibold">Its rate</th>
                <th className="px-3 py-2 text-right font-semibold">Cost (₹)</th>
              </tr>
            </thead>
            <tbody>
              {funding.map((f) => (
                <tr key={f.deposit_id} className="border-t border-sky-50">
                  <td className="px-3 py-2 font-medium text-slate-700">{f.voucher_no}</td>
                  <td className="px-3 py-2 text-slate-600">{fmtDate(f.deposit_date)}</td>
                  <td className="px-3 py-2 text-slate-600">{f.depositor_name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatQty(f.fx_allocated)} {d.src_currency}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{formatRate(f.manual_rate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatINR(f.cost_inr)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-sky-100 bg-sky-50/70 font-semibold">
              <tr>
                <td colSpan={3} className="px-3 py-2 text-right text-slate-600">{funding.length} deposit{funding.length === 1 ? "" : "s"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatQty(d.src_amount)} {d.src_currency}</td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-right tabular-nums">{formatINR(d.src_cost_inr)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Card title="The arithmetic" icon="fa-calculator">
        <div className="space-y-2 text-sm">
          <Line label={`${formatQty(d.fx_amount)} ${d.fx_currency} × ${Number(d.fx_to_inr_rate).toFixed(6)}`} value={formatINR(d.billed_inr)} note="what the client owes us" />
          <Line label={`${formatQty(d.src_amount)} ${d.src_currency} at what each deposit cost`} value={`− ${formatINR(d.src_cost_inr)}`} note="what the currency cost us" />
          <div className="border-t border-slate-200 pt-2">
            <Line label={margin < 0 ? "Loss on this deal" : "Margin on this deal"} value={formatINR(margin)} strong note={`1 ${d.src_currency} became ${Number(d.src_to_fx_rate).toFixed(6)} ${d.fx_currency}`} />
          </div>
        </div>
      </Card>

      {(d.reference_no || d.narration) && (
        <Card title="Notes" icon="fa-note-sticky">
          {d.reference_no && <p className="text-sm"><span className="text-slate-500">Reference:</span> {d.reference_no}</p>}
          {d.narration && <p className="mt-1 text-sm text-slate-700">{d.narration}</p>}
        </Card>
      )}

      <p className="text-xs text-slate-500">
        <Icon name="fa-circle-info" className="mr-1" />
        A booked deal is never edited. If it is wrong, reverse the voucher and book it again.
      </p>
    </>
  );
}

function Line({ label, value, note, strong }: { label: string; value: string; note?: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className={strong ? "font-semibold text-slate-800" : "text-slate-600"}>{label}
        {note && <span className="ml-2 text-xs text-slate-400">{note}</span>}</span>
      <span className={`tabular-nums ${strong ? "text-lg font-semibold text-slate-900" : "text-slate-700"}`}>{value}</span>
    </div>
  );
}
