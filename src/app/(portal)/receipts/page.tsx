import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, Icon, LinkButton, Note, PageHeader } from "@/components/ui";
import { getCompanyInfo } from "@/lib/company";
import { fmtDate, fyStartISO, todayISO } from "@/lib/format";
import { formatINR } from "@/lib/money";
import { getPermissions } from "@/lib/permissions";
import { requireSession } from "@/lib/session";
import { clientPositions } from "@/server/services/clients";
import { listVouchers } from "@/server/services/ledger";

export const metadata: Metadata = { title: "Receipts" };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function ReceiptsPage({ searchParams }: PageProps<"/receipts">) {
  const s = await requireSession();
  if (s.preview) return <Note tone="amber">Needs a real login.</Note>;
  const perms = await getPermissions(s);
  if (!perms.has("voucher.view")) return <Note tone="rose">You do not have permission to see receipts.</Note>;

  const company = await getCompanyInfo(s);
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const from = DATE.test(one("from")) ? one("from") : fyStartISO(company.fiscalYearStartMonth);
  const to = DATE.test(one("to")) ? one("to") : todayISO();

  const { rows, total } = await listVouchers(s, { from, to, type: "RECEIPT", limit: 100 });
  const positions = perms.has("report.view") ? await clientPositions(s) : [];
  const owing = positions.filter((p) => Number(p.receivable_inr) > 0);
  const advances = positions.filter((p) => Number(p.receivable_inr) < 0);
  const outstanding = owing.reduce((a, p) => a + Number(p.receivable_inr), 0);
  const taken = rows.reduce((a, r) => a + Number(r.total_inr), 0);
  const sel = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm";

  return (
    <>
      <PageHeader
        title="Receipts"
        crumbs={["Daily work"]}
        subtitle="Rupees coming in from clients. This is the money that settles the depositors."
        actions={perms.has("voucher.create") && <LinkButton href="/receipts/new" icon="fa-plus">Record a receipt</LinkButton>}
      />

      {owing.length > 0 ? (
        <Card title={`Still to collect — ${formatINR(outstanding, { decimals: 0 })} from ${owing.length} client${owing.length > 1 ? "s" : ""}`} icon="fa-file-invoice">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {owing.map((p) => (
              <div key={p.party_id} className="rounded-xl border border-sky-100 px-4 py-3">
                <Link href={`/parties/${p.party_id}`} className="font-medium text-slate-800 hover:underline">{p.full_name}</Link>
                <div className="mt-1 text-xl font-semibold tabular-nums text-slate-800">{formatINR(p.receivable_inr)}</div>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>billed {formatINR(p.billed_inr, { decimals: 0 })}, paid {formatINR(p.received_inr, { decimals: 0 })}</span>
                  {perms.has("voucher.create") && (
                    <Link href={`/receipts/new?client=${p.party_id}`} className="font-medium text-sky-700 hover:underline">Collect</Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <Note tone="emerald" icon="fa-circle-check">Every client has paid what they were billed.</Note>
      )}

      {advances.length > 0 && (
        <Note tone="amber" icon="fa-hand-holding-dollar">
          Paid in advance: {advances.map((p) => `${p.full_name} ${formatINR(-Number(p.receivable_inr), { decimals: 0 })}`).join(", ")}.
          It sits as a credit on their ledger until the next deal.
        </Note>
      )}

      <Card title="Received" icon="fa-inbox"
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
              <tr>{["Voucher", "Date", "Client", "Reference", "Amount (₹)"].map((h, i) => (
                <th key={h} className={`px-3 py-2 font-semibold ${i === 4 ? "text-right" : "text-left"}`}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-sky-50 hover:bg-sky-50/40">
                  <td className="px-3 py-2"><Link href={`/vouchers/${r.id}`} className="font-medium text-sky-700 hover:underline">{r.voucher_no}</Link></td>
                  <td className="px-3 py-2 text-slate-600">{fmtDate(r.voucher_date)}</td>
                  <td className="px-3 py-2">{r.party_name ?? <Badge tone="slate">no client</Badge>}</td>
                  <td className="px-3 py-2 text-slate-500">{r.reference_no ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatINR(r.total_inr)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-10 text-center text-slate-500">
                  <Icon name="fa-inbox" className="mr-2 text-slate-300" />No receipt in this period.
                </td></tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="border-t border-sky-100 bg-sky-50/70 font-semibold">
                <tr><td colSpan={4} className="px-3 py-2 text-right text-slate-600">{total} receipt{total === 1 ? "" : "s"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatINR(taken)}</td></tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
    </>
  );
}
