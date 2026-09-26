import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, Icon, Note, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { VOUCHER_TYPES } from "@/lib/ledger";
import { formatINR } from "@/lib/money";
import { getPermissions } from "@/lib/permissions";
import { checkRate } from "@/lib/ratelimit";
import { requireSession } from "@/lib/session";
import { listVouchers } from "@/server/services/ledger";
import { listParties } from "@/server/services/parties";

export const metadata: Metadata = { title: "Search" };
const LIMIT = 15;

/** Global search: parties and vouchers, within what the user is allowed to see. */
export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const s = await requireSession();
  if (s.preview) return <Note tone="amber">Needs a real login.</Note>;
  const sp = await searchParams;
  const q = (typeof sp.q === "string" ? sp.q : "").trim().slice(0, 60);
  const perms = await getPermissions(s);
  const tooShort = q.length < 2;
  const limited = !tooShort && !(await checkRate("search", s.companyId, s.userId)).ok;

  const parties = !tooShort && !limited && perms.has("party.view") ? (await listParties(s, { q, limit: LIMIT + 1 })).rows : [];
  const vouchers = !tooShort && !limited && perms.has("voucher.view") ? (await listVouchers(s, { q, limit: LIMIT + 1 })).rows : [];
  const th = "px-4 py-2 text-xs font-semibold uppercase text-slate-500";

  return (
    <>
      <PageHeader title="Search" crumbs={["Overview"]} subtitle="Voucher numbers, party names and codes, mobile numbers, references and narrations." />
      <Card>
        <form className="flex gap-3">
          <div className="relative flex-1 max-w-xl">
            <Icon name="fa-magnifying-glass" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm" />
            <input name="q" type="search" defaultValue={q} autoFocus required minLength={2} maxLength={60} aria-label="Search"
              className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2 text-sm" placeholder="e.g. DEP/00001, Rajesh, 98765" />
          </div>
          <button className="rounded-lg bg-sky-600 text-white px-4 py-2 text-sm font-medium">Search</button>
        </form>
      </Card>
      {tooShort && q.length > 0 && <Note>Type at least 2 characters.</Note>}
      {limited && <Note tone="amber" icon="fa-hourglass-half">Too many searches in a minute. Wait a moment and try again.</Note>}
      {!tooShort && !limited && parties.length === 0 && vouchers.length === 0 && <Note tone="slate" icon="fa-circle-info">Nothing found for “{q}”.</Note>}

      {parties.length > 0 && (
        <Card title={`Parties (${parties.length > LIMIT ? `${LIMIT}+` : parties.length})`} icon="fa-users" padded={false}>
          <table className="w-full text-sm">
            <thead className="bg-sky-50/70"><tr>{["Code", "Name", "Role", "Mobile", "Owes us", "We owe"].map((h, i) => <th key={h} className={`${th} ${i >= 4 ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
            <tbody>
              {parties.slice(0, LIMIT).map((p) => (
                <tr key={p.id} className="border-t border-sky-50 hover:bg-sky-50/50">
                  <td className="px-4 py-2.5 text-slate-600">{p.party_code}</td>
                  <td className="px-4 py-2.5"><Link href={`/parties/${p.id}`} className="font-medium text-sky-700">{p.full_name}</Link></td>
                  <td className="px-4 py-2.5">{p.is_depositor && <Badge tone="violet">Depositor</Badge>} {p.is_client && <Badge tone="sky">Client</Badge>}</td>
                  <td className="px-4 py-2.5 text-slate-600">{p.phone ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{Number(p.receivable_inr) ? formatINR(p.receivable_inr, { decimals: 0 }) : "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{Number(p.payable_inr) ? formatINR(p.payable_inr, { decimals: 0 }) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {vouchers.length > 0 && (
        <Card title={`Vouchers (${vouchers.length > LIMIT ? `${LIMIT}+` : vouchers.length})`} icon="fa-file-lines" padded={false}>
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-sky-50/70"><tr>{["Voucher", "Date", "Type", "Party", "Amount (₹)"].map((h, i) => <th key={h} className={`${th} ${i === 4 ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
            <tbody>
              {vouchers.slice(0, LIMIT).map((v) => (
                <tr key={v.id} className="border-t border-sky-50 hover:bg-sky-50/50">
                  <td className="px-4 py-2.5"><Link href={`/vouchers/${v.id}`} className="font-medium text-sky-700">{v.voucher_no}</Link></td>
                  <td className="px-4 py-2.5 text-slate-600">{fmtDate(v.voucher_date)}</td>
                  <td className="px-4 py-2.5">{VOUCHER_TYPES[v.voucher_type]}</td>
                  <td className="px-4 py-2.5">{v.party_name ?? <span className="text-slate-400">—</span>}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatINR(v.total_inr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
