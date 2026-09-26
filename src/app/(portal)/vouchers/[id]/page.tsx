import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ModalButton } from "@/components/ModalButton";
import { ReasonForm } from "@/components/ReasonForm";
import { Badge, Card, Icon, Note, PageHeader } from "@/components/ui";
import { reverseVoucherAction } from "@/app/actions/yearend";
import { getPermissions } from "@/lib/permissions";
import { fmtDate, fmtTime } from "@/lib/format";
import { VOUCHER_TYPES } from "@/lib/ledger";
import { formatINR, formatQty } from "@/lib/money";
import { requireSession } from "@/lib/session";
import { getVoucher } from "@/server/services/ledger";

export const metadata: Metadata = { title: "Voucher" };

export default async function VoucherPage({ params }: PageProps<"/vouchers/[id]">) {
  const s = await requireSession();
  if (s.preview) return <Note tone="amber">Needs a real login.</Note>;
  const { id } = await params;
  const data = await getVoucher(s, Number(id));
  if (!data) notFound();
  const { voucher: v, lines } = data;
  const perms = await getPermissions(s);
  const canReverse = perms.has("voucher.reverse") && v.status === "POSTED" && v.voucher_type !== "REVERSAL";
  const debit = lines.filter((l) => l.dc === "D").reduce((a, l) => a + Number(l.inr_amount), 0);
  const credit = lines.filter((l) => l.dc === "C").reduce((a, l) => a + Number(l.inr_amount), 0);

  return (
    <>
      <PageHeader
        title={v.voucher_no}
        crumbs={["Ledger", "Vouchers"]}
        subtitle={<>{VOUCHER_TYPES[v.voucher_type]} · {fmtDate(v.voucher_date)} {v.party_name ? <>· <Link href={`/parties/${v.party_id}`} className="text-sky-700">{v.party_name}</Link></> : null} {v.status === "REVERSED" && <Badge tone="rose">Reversed</Badge>}</>}
        actions={canReverse && (
          <ModalButton label="Reverse" icon="fa-rotate-left" variant="secondary" title={`Reverse ${v.voucher_no}`}>
            <ReasonForm
              action={reverseVoucherAction}
              id={v.id}
              name="reason"
              label="Why is this being reversed?"
              placeholder="Rate was wrong / client never collected it / entered twice"
              submit="Reverse it"
              warning={`${v.voucher_no} will not be edited or removed. An equal and opposite voucher is posted, both stay on the record, and the reason you give here goes with them.`}
            />
          </ModalButton>
        )}
      />
      {v.status === "REVERSED" && v.reversed_by && (
        <Note tone="rose" icon="fa-rotate-left">
          This voucher was cancelled by{" "}
          <Link href={`/vouchers/${v.reversed_by}`} className="font-medium underline">{v.reversed_by_no}</Link>.
          Both are still in the books; together they come to nothing.
        </Note>
      )}
      {v.reversal_of && (
        <Note tone="amber" icon="fa-rotate-left">
          This voucher cancels{" "}
          <Link href={`/vouchers/${v.reversal_of}`} className="font-medium underline">{v.reversal_of_no}</Link>.
        </Note>
      )}
      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-sky-50/70">
              <tr>{["#", "Account", "Party", "Currency", "Amount", "Rate", "Debit (₹)", "Credit (₹)"].map((h, i) => (
                <th key={h} className={`px-4 py-2.5 text-xs font-semibold uppercase text-slate-500 ${i >= 4 ? "text-right" : "text-left"}`}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.line_no} className="border-t border-sky-50">
                  <td className="px-4 py-2.5 text-slate-400">{l.line_no}</td>
                  <td className="px-4 py-2.5 font-medium">{l.account_name}<div className="text-xs text-slate-500">{l.account_code}{l.remarks ? ` · ${l.remarks}` : ""}</div></td>
                  <td className="px-4 py-2.5">{l.party_id ? <Link href={`/parties/${l.party_id}`} className="text-sky-700">{l.party_name}</Link> : <span className="text-slate-400">—</span>}</td>
                  <td className="px-4 py-2.5 text-right">{l.currency_code.trim()}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatQty(l.fx_amount, 2)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{Number(l.manual_rate) === 1 ? "—" : Number(l.manual_rate).toFixed(6)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{l.dc === "D" ? formatINR(l.inr_amount) : ""}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{l.dc === "C" ? formatINR(l.inr_amount) : ""}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-sky-50/70 border-t border-sky-100 font-semibold">
              <tr>
                <td colSpan={6} className="px-4 py-2.5 text-right">Total</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatINR(debit)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatINR(credit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
      <div className="grid md:grid-cols-2 gap-4 text-sm">
        <Card title="Details" icon="fa-circle-info">
          <dl className="space-y-1.5 text-slate-600">
            {v.narration && <div><dt className="inline font-medium text-slate-700">Narration: </dt><dd className="inline">{v.narration}</dd></div>}
            {v.reference_no && <div><dt className="inline font-medium text-slate-700">Reference: </dt><dd className="inline">{v.reference_no}</dd></div>}
            <div><dt className="inline font-medium text-slate-700">Posted: </dt><dd className="inline">{fmtDate(v.voucher_date)} at {fmtTime(v.posted_at)} by {v.created_by_name}</dd></div>
          </dl>
        </Card>
        <Note tone="slate" icon="fa-lock">
          This voucher is part of the books and can never be edited or deleted. A mistake is corrected by posting a reversal and a fresh entry, so the audit trail stays complete.
        </Note>
      </div>
      <Link href="/vouchers" className="text-sm text-sky-700"><Icon name="fa-arrow-left" className="mr-1" />All vouchers</Link>
    </>
  );
}
