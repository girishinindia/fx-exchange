import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, Icon, LinkButton, Note, PageHeader } from "@/components/ui";
import { getCompanyInfo } from "@/lib/company";
import { fmtDate, fyStartISO, todayISO } from "@/lib/format";
import { VOUCHER_TYPES, type VoucherType } from "@/lib/ledger";
import { formatINR } from "@/lib/money";
import { getPermissions } from "@/lib/permissions";
import { requireSession } from "@/lib/session";
import { listVouchers } from "@/server/services/ledger";

export const metadata: Metadata = { title: "Vouchers" };
const PAGE = 50;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function VouchersPage({ searchParams }: PageProps<"/vouchers">) {
  const s = await requireSession();
  if (s.preview) return <Note tone="amber">Needs a real login.</Note>;
  const perms = await getPermissions(s);
  if (!perms.has("voucher.view")) return <Note tone="rose">You do not have permission to see vouchers.</Note>;

  const company = await getCompanyInfo(s);
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const from = DATE.test(one("from")) ? one("from") : fyStartISO(company.fiscalYearStartMonth);
  const to = DATE.test(one("to")) ? one("to") : todayISO();
  const type = (Object.keys(VOUCHER_TYPES) as VoucherType[]).includes(one("type") as VoucherType) ? (one("type") as VoucherType) : null;
  const q = one("q").slice(0, 60) || null;
  const page = Math.max(1, Number(one("page")) || 1);
  const { rows, total } = await listVouchers(s, { from, to, type, q, limit: PAGE, offset: (page - 1) * PAGE });
  const sel = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm";
  const qs = (extra: Record<string, string>) =>
    "?" + new URLSearchParams(Object.entries({ from, to, type: type ?? "", q: q ?? "", ...extra }).filter(([, v]) => v)).toString();

  return (
    <>
      <PageHeader
        title="Vouchers"
        crumbs={["Ledger"]}
        subtitle="Every entry in the books, newest first. Open one to see its debits and credits."
        actions={perms.has("voucher.create") && <LinkButton href="/vouchers/new" icon="fa-plus">New voucher</LinkButton>}
      />
      <Card>
        <form className="flex flex-wrap items-end gap-3">
          <label className="block w-36"><span className="text-xs font-medium text-slate-500">From</span><input type="date" name="from" defaultValue={from} className={sel} /></label>
          <label className="block w-36"><span className="text-xs font-medium text-slate-500">To</span><input type="date" name="to" defaultValue={to} className={sel} /></label>
          <label className="block w-48"><span className="text-xs font-medium text-slate-500">Type</span>
            <select name="type" defaultValue={type ?? ""} className={sel}>
              <option value="">All types</option>
              {Object.entries(VOUCHER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="block w-56"><span className="text-xs font-medium text-slate-500">Search</span><input name="q" defaultValue={q ?? ""} placeholder="No., party, narration" className={sel} /></label>
          <button className="rounded-lg bg-sky-600 text-white px-3.5 py-2 text-sm font-medium"><Icon name="fa-filter" className="mr-1" />Apply</button>
          <Link href="/vouchers" className="text-sm text-sky-700 px-2 py-2">Reset</Link>
        </form>
      </Card>
      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-sky-50/70">
              <tr>{["Voucher", "Date", "Type", "Party", "Narration", "Drawers", "Amount (₹)", "By"].map((h, i) => (
                <th key={h} className={`px-4 py-2.5 text-xs font-semibold uppercase text-slate-500 ${i === 6 ? "text-right" : "text-left"}`}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">No vouchers for these filters.</td></tr>}
              {rows.map((v) => (
                <tr key={v.id} className={`border-t border-sky-50 hover:bg-sky-50/50 ${v.status === "REVERSED" ? "opacity-60" : ""}`}>
                  <td className="px-4 py-2.5"><Link href={`/vouchers/${v.id}`} className="font-medium text-sky-700">{v.voucher_no}</Link></td>
                  <td className="px-4 py-2.5 text-slate-600">{fmtDate(v.voucher_date)}</td>
                  <td className="px-4 py-2.5"><Badge tone={v.voucher_type === "DEAL" ? "violet" : v.voucher_type === "OPENING" ? "slate" : "sky"}>{VOUCHER_TYPES[v.voucher_type]}</Badge></td>
                  <td className="px-4 py-2.5">{v.party_id ? <Link href={`/parties/${v.party_id}`} className="hover:text-sky-700">{v.party_name}</Link> : <span className="text-slate-400">—</span>}</td>
                  <td className="px-4 py-2.5 text-slate-600 max-w-xs truncate">{v.narration ?? v.reference_no ?? ""}</td>
                  <td className="px-4 py-2.5 text-xs tabular-nums text-slate-600">{[v.fx_move, v.cash_move].filter(Boolean).join(" · ") || <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatINR(v.total_inr)}</td>
                  <td className="px-4 py-2.5 text-slate-600">{v.created_by_name?.split(" ")[0]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center px-4 py-3 border-t border-sky-100 text-sm text-slate-500">
          {total} voucher(s)
          <div className="ml-auto flex gap-1">
            {page > 1 && <Link href={qs({ page: String(page - 1) })} className="px-3 py-1 rounded border border-sky-100 hover:bg-sky-50">‹ Previous</Link>}
            {total > page * PAGE && <Link href={qs({ page: String(page + 1) })} className="px-3 py-1 rounded border border-sky-100 hover:bg-sky-50">Next ›</Link>}
          </div>
        </div>
      </Card>
    </>
  );
}
