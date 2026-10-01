import type { Metadata } from "next";
import Link from "next/link";
import { BarChart } from "@/components/BarChart";
import { Badge, Card, Icon, Kpi, LinkButton, Note, PageHeader } from "@/components/ui";
import { getCompanyInfo } from "@/lib/company";
import { fmtDate } from "@/lib/format";
import { VOUCHER_TYPES } from "@/lib/ledger";
import { formatINR, formatQty } from "@/lib/money";
import { getPermissions } from "@/lib/permissions";
import { requireSession, tenantOf } from "@/lib/session";
import { withTenant } from "@/lib/db";
import { liquidity } from "@/server/services/ledger";

type OpenCycle = {
  party_id: string; full_name: string; currency: string;
  unspent_fx: string; uncollected_inr: string; owed_fx: string; earned_inr: string;
};

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Liquidity first, profit second: in this business most of the money on hand belongs
 * to someone else, so the home screen leads with what is owed and what is owed to us.
 */
export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const s = await requireSession();
  const denied = (await searchParams).denied;
  if (s.preview) return <Note tone="amber">Development preview — sign in to see the dashboard.</Note>;
  const perms = await getPermissions(s);
  const company = await getCompanyInfo(s);

  if (!perms.has("report.view")) {
    return (
      <>
        <PageHeader title={`Welcome, ${s.userName.split(" ")[0]}`} crumbs={["Overview"]} subtitle={company.name} />
        {typeof denied === "string" && <Note tone="rose" icon="fa-ban">You do not have permission for that page (<code>{denied}</code>).</Note>}
        <Note icon="fa-circle-info">Your role can enter vouchers. Open <Link href="/vouchers" className="underline font-medium">Vouchers</Link> to start.</Note>
      </>
    );
  }

  const d = await liquidity(s);
  // the open cycles: whose money is still somewhere in the loop, and where
  const cycles = await withTenant(await tenantOf(s), (tx) => tx<OpenCycle[]>`
    select party_id, full_name, trim(currency) as currency,
           unspent_fx::text, uncollected_inr::text, owed_fx::text, earned_inr::text
      from ex.v_depositor_cycle
     where status = 'OPEN'
     order by owed_inr desc, full_name
     limit 8`);
  // Rupees sit in more than one drawer — cash and bank — so this is a sum, not the first one found.
  const rupeeDrawers = d.cash.filter((c) => c.currency_code.trim() === company.baseCurrency);
  const foreign = d.cash.filter((c) => c.currency_code.trim() !== company.baseCurrency && Number(c.balance_fx) !== 0);
  const owed = Number(d.totals.owed_to_depositors);
  const collect = Number(d.totals.to_collect);
  const deliver = Number(d.totals.currency_to_deliver);
  const rupees = rupeeDrawers.reduce((a, c) => a + Number(c.balance_inr), 0);
  const profit = Number(d.totals.margin) - Number(d.totals.expenses);
  const balanced = Math.abs(Number(d.tb.dr) - Number(d.tb.cr)) < 0.005;
  const shortfall = owed - rupees;
  // A currency is short only against itself — EUR promised is covered by EUR held, never by dollars.
  const short = d.cover
    .map((c) => ({ currency: c.currency_code.trim(), short: Number(c.owed_fx) - Number(c.held_fx) }))
    .filter((c) => c.currency !== company.baseCurrency && c.short > 0.0001);

  return (
    <>
      <PageHeader
        title="Dashboard"
        crumbs={["Overview"]}
        subtitle={`${company.name} · ${fmtDate(new Date())} · deal currency ${company.primaryCurrency}, books in ${company.baseCurrency}`}
        actions={<>
          <LinkButton href="/reports/trialbalance" variant="ghost" icon="fa-scale-balanced">Trial balance</LinkButton>
          {perms.has("voucher.create") && <LinkButton href="/vouchers/new" icon="fa-plus">New voucher</LinkButton>}
        </>}
      />
      {typeof denied === "string" && <Note tone="rose" icon="fa-ban">You do not have permission for that page (<code>{denied}</code>).</Note>}
      {!balanced && <Note tone="rose" icon="fa-triangle-exclamation">The books are out of balance by {formatINR(Math.abs(Number(d.tb.dr) - Number(d.tb.cr)))}. Open the trial balance and check the latest vouchers.</Note>}
      {shortfall > 0 && owed > 0 && (
        <Note tone="amber" icon="fa-triangle-exclamation">
          We owe depositors {formatINR(owed, { decimals: 0 })} but hold only {formatINR(rupees, { decimals: 0 })} in rupees —
          short by <b>{formatINR(shortfall, { decimals: 0 })}</b>. Collect from clients before settling.
        </Note>
      )}
      {short.length > 0 && (
        <Note tone="amber" icon="fa-scale-unbalanced">
          Promised to clients but not held: {short.map((c) => `${c.currency} ${c.short.toLocaleString("en-IN", { maximumFractionDigits: 4 })}`).join(", ")}.
          Buy the currency before delivering.
        </Note>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="We owe depositors" value={formatINR(owed, { decimals: 0 })} sub="rupees still to be settled" icon="fa-hand-holding-dollar" tone="rose" />
        <Kpi label="Clients owe us" value={formatINR(collect, { decimals: 0 })} sub="rupees still to be collected" icon="fa-file-invoice" tone="amber" />
        <Kpi label="Rupees in hand" value={formatINR(rupees, { decimals: 0 })} sub="cash and bank, INR only" icon="fa-indian-rupee-sign" tone="sky" />
        <Kpi label="Profit so far" value={formatINR(profit, { decimals: 0 })} sub={`margin ${formatINR(d.totals.margin, { decimals: 0 })} − expenses ${formatINR(d.totals.expenses, { decimals: 0 })}`} icon="fa-coins" tone="emerald" />
      </div>

      <div className="grid xl:grid-cols-3 gap-6 items-start">
        <Card title="What we hold" icon="fa-vault" padded={false} className="xl:col-span-1"
          actions={<LinkButton href="/reports/currencyposition" variant="ghost">Position</LinkButton>}>
          <table className="w-full text-sm">
            <thead className="bg-sky-50/70">
              <tr>{["Currency", "Held", "Value (₹)"].map((h, i) => <th key={h} className={`px-4 py-2 text-xs font-semibold uppercase text-slate-500 ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {d.cash.filter((c) => Number(c.balance_fx) !== 0 || c.currency_code.trim() === company.baseCurrency).map((c) => {
                // The base currency has a drawer each for cash and for bank, so the code alone
                // would print "INR" twice. Name the drawer instead, as the Money page does.
                const isBase = c.currency_code.trim() === company.baseCurrency;
                return (
                  <tr key={c.code} className="border-t border-sky-50">
                    <td className="px-4 py-2 font-medium">{isBase ? `₹ ${c.name.replace(/ — .*$/, "")}` : c.currency_code.trim()}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{isBase ? <span className="text-slate-300">—</span> : formatQty(c.balance_fx, 2)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatINR(c.balance_inr, { decimals: 0 })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {foreign.length > 0 && <p className="px-4 py-3 text-xs text-slate-500 border-t border-sky-50">Foreign currency here is mostly owed to clients — it is not free money.</p>}
        </Card>

        <Card title="Where the money stands" icon="fa-scale-balanced" className="xl:col-span-2">
          <BarChart
            title="Rupees"
            data={[
              { label: "In hand", value: rupees },
              { label: "To collect", value: collect },
              { label: "To settle", value: -owed },
              { label: "Currency due", value: -deliver },
            ]}
            height={180}
          />
          <p className="mt-3 text-xs text-slate-500">Green above the line is money available or coming in; below the line is money and currency owed to others.</p>
        </Card>
      </div>

      <Card title="Whose money is still in the loop" icon="fa-rotate" padded={false}
            actions={<LinkButton href="/reports/cycles" variant="ghost">Every depositor</LinkButton>}>
        {cycles.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">Every cycle is closed — nothing unspent, nothing uncollected, nobody owed.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-sky-50/70">
                <tr>{["Depositor", "Still unspent", "Clients still owe", "Still owed to them", "Earned so far"].map((h, i) => (
                  <th key={h} className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 ${i ? "text-right" : "text-left"}`}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {cycles.map((c) => (
                  <tr key={c.party_id} className="border-t border-sky-50 hover:bg-sky-50/50">
                    <td className="px-4 py-2.5"><Link href={`/parties/${c.party_id}`} className="font-medium text-sky-700">{c.full_name}</Link></td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{Number(c.unspent_fx) ? `${formatQty(c.unspent_fx)} ${c.currency}` : <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{Number(c.uncollected_inr) ? formatINR(c.uncollected_inr, { decimals: 0 }) : <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{Number(c.owed_fx) ? `${formatQty(c.owed_fx)} ${c.currency}` : <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">{formatINR(c.earned_inr, { decimals: 0 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-4 py-3 text-xs text-slate-500 border-t border-sky-50">
              Left to right is the order the money moves: in, out to clients, back from clients, home to the depositor. A blank means that stage is done.
            </p>
          </div>
        )}
      </Card>

      <Card title="Latest vouchers" icon="fa-file-lines" padded={false} actions={<LinkButton href="/vouchers" variant="ghost">All vouchers</LinkButton>}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-sky-50/70">
              <tr>{["Voucher", "Date", "Type", "Party", "Amount (₹)", "By"].map((h, i) => (
                <th key={h} className={`px-4 py-2 text-xs font-semibold uppercase text-slate-500 ${i === 4 ? "text-right" : "text-left"}`}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {d.vouchers.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No vouchers yet. Start with the <Link href="/opening" className="text-sky-700 underline">opening balance</Link>.
                </td></tr>
              )}
              {d.vouchers.map((v) => (
                <tr key={v.id} className="border-t border-sky-50 hover:bg-sky-50/50">
                  <td className="px-4 py-2"><Link href={`/vouchers/${v.id}`} className="font-medium text-sky-700">{v.voucher_no.split("/").slice(-2).join("/")}</Link></td>
                  <td className="px-4 py-2 text-slate-600">{fmtDate(v.voucher_date)}</td>
                  <td className="px-4 py-2"><Badge tone={v.voucher_type === "DEAL" ? "violet" : "sky"}>{VOUCHER_TYPES[v.voucher_type]}</Badge></td>
                  <td className="px-4 py-2">{v.party_name ?? <span className="text-slate-400">—</span>}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatINR(v.total_inr, { decimals: 0 })}</td>
                  <td className="px-4 py-2 text-slate-600">{v.created_by_name?.split(" ")[0]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-xs text-slate-500"><Icon name="fa-circle-check" className="mr-1 text-emerald-600" />Books balance: debits {formatINR(d.tb.dr)} = credits {formatINR(d.tb.cr)}.</p>
    </>
  );
}
