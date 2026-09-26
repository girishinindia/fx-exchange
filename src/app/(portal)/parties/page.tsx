import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, Icon, LinkButton, Note, PageHeader } from "@/components/ui";
import { formatINR } from "@/lib/money";
import { getPermissions } from "@/lib/permissions";
import { requireSession } from "@/lib/session";
import { listParties } from "@/server/services/parties";

export const metadata: Metadata = { title: "Depositors & clients" };
const PAGE = 50;

export default async function PartiesPage({ searchParams }: PageProps<"/parties">) {
  const s = await requireSession();
  if (s.preview) return <Note tone="amber">Needs a real login.</Note>;
  const perms = await getPermissions(s);
  if (!perms.has("party.view")) return <Note tone="rose">You do not have permission to see parties.</Note>;

  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const kind = one("kind") === "CLIENT" || one("kind") === "DEPOSITOR" ? (one("kind") as "CLIENT" | "DEPOSITOR") : null;
  const q = one("q").slice(0, 60) || null;
  const page = Math.max(1, Number(one("page")) || 1);
  const { rows, total } = await listParties(s, { kind, q, limit: PAGE, offset: (page - 1) * PAGE });
  const sel = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm";

  return (
    <>
      <PageHeader
        title="Depositors & clients"
        crumbs={["Parties"]}
        subtitle="Depositors bring in currency and are owed rupees. Clients buy currency and pay rupees. A firm can be both."
        actions={perms.has("party.manage") && <LinkButton href="/parties/new" icon="fa-plus">Add party</LinkButton>}
      />
      <Card>
        <form className="flex flex-wrap items-end gap-3">
          <label className="block w-44"><span className="text-xs font-medium text-slate-500">Show</span>
            <select name="kind" defaultValue={kind ?? ""} className={sel}>
              <option value="">Everyone</option>
              <option value="DEPOSITOR">Depositors</option>
              <option value="CLIENT">Clients</option>
            </select>
          </label>
          <label className="block w-64"><span className="text-xs font-medium text-slate-500">Search</span>
            <input name="q" defaultValue={q ?? ""} placeholder="Name, code, mobile, GSTIN" className={sel} /></label>
          <button className="rounded-lg bg-sky-600 text-white px-3.5 py-2 text-sm font-medium"><Icon name="fa-filter" className="mr-1" />Apply</button>
          <Link href="/parties" className="text-sm text-sky-700 px-2 py-2">Reset</Link>
        </form>
      </Card>
      <Card padded={false}>
        <table className="w-full text-sm">
          <thead className="bg-sky-50/70">
            <tr>{["Code", "Name", "Role", "Mobile", "City", "Owes us", "We owe"].map((h, i) => (
              <th key={h} className={`px-4 py-2.5 text-xs font-semibold uppercase text-slate-500 ${i >= 5 ? "text-right" : "text-left"}`}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">No parties yet.</td></tr>}
            {rows.map((p) => (
              <tr key={p.id} className={`border-t border-sky-50 hover:bg-sky-50/50 ${p.is_active ? "" : "opacity-60"}`}>
                <td className="px-4 py-2.5 text-slate-600">{p.party_code}</td>
                <td className="px-4 py-2.5"><Link href={`/parties/${p.id}`} className="font-medium text-sky-700">{p.full_name}</Link>{!p.is_active && <span className="ml-2"><Badge tone="slate">Inactive</Badge></span>}</td>
                <td className="px-4 py-2.5">
                  {p.is_depositor && <Badge tone="violet">Depositor</Badge>}{p.is_depositor && p.is_client && " "}
                  {p.is_client && <Badge tone="sky">Client</Badge>}
                </td>
                <td className="px-4 py-2.5 text-slate-600">{p.phone ?? "—"}</td>
                <td className="px-4 py-2.5 text-slate-600">{p.city ?? "—"}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{Number(p.receivable_inr) ? formatINR(p.receivable_inr, { decimals: 0 }) : <span className="text-slate-400">—</span>}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{Number(p.payable_inr) ? <span className="text-rose-700">{formatINR(p.payable_inr, { decimals: 0 })}</span> : <span className="text-slate-400">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center px-4 py-3 border-t border-sky-100 text-sm text-slate-500">
          {total} part{total === 1 ? "y" : "ies"}
          <div className="ml-auto flex gap-1">
            {page > 1 && <Link href={`/parties?page=${page - 1}`} className="px-3 py-1 rounded border border-sky-100 hover:bg-sky-50">‹ Previous</Link>}
            {total > page * PAGE && <Link href={`/parties?page=${page + 1}`} className="px-3 py-1 rounded border border-sky-100 hover:bg-sky-50">Next ›</Link>}
          </div>
        </div>
      </Card>
    </>
  );
}
