import type { Metadata } from "next";
import Link from "next/link";
import { Card, Icon, LinkButton, Note } from "@/components/ui";
import { getCompanyInfo } from "@/lib/company";
import { formatINR, formatQty, formatRate } from "@/lib/money";
import { requirePermission } from "@/lib/permissions";
import { liquidity, partyBalances } from "@/server/services/ledger";

export const metadata: Metadata = { title: "Money" };

/**
 * Three questions, three cards: what do we hold, who owes us, whom do we owe.
 * Every figure is the same view the full dashboard and the reports read.
 */
export default async function MoneyPage() {
  const s = await requirePermission("report.view");
  if (s.preview) return <Note tone="amber">Needs a real login.</Note>;
  const company = await getCompanyInfo(s);
  const [d, balances] = await Promise.all([liquidity(s), partyBalances(s)]);
  const base = company.baseCurrency;
  const cash = d.cash.filter((c) => Number(c.balance_fx) !== 0 || Number(c.balance_inr) !== 0);
  const oweUs = balances.filter((b) => b.account_group === "RECEIVABLE" && Number(b.balance_inr) > 0);
  const advances = balances.filter((b) => b.account_group === "RECEIVABLE" && Number(b.balance_inr) < 0);
  const weOweCur = balances.filter((b) => b.account_group === "CURRENCY_PAYABLE" && Number(b.balance_fx) < 0);
  const weOweDep = balances.filter((b) => b.account_group === "PAYABLE" && Number(b.balance_inr) < 0);
  const totalHeld = cash.reduce((a, c) => a + Number(c.balance_inr), 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="What we hold" icon="fa-wallet" padded={false} actions={<LinkButton href="/reports/currencyposition" variant="ghost">Report</LinkButton>}>
          <ul className="divide-y divide-sky-50">
            {cash.map((c) => (
              <li key={c.code} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="font-semibold">{c.currency_code.trim() === base ? "Rupees" : c.currency_code.trim()} <span className="font-normal text-slate-400">{c.name}</span></span>
                <span className="text-right tabular-nums">
                  <b>{c.currency_code.trim() === base ? formatINR(c.balance_inr, { decimals: 0 }) : `${formatQty(c.balance_fx)} ${c.currency_code.trim()}`}</b>
                  {c.currency_code.trim() !== base && <div className="text-xs text-slate-500">{formatINR(c.balance_inr, { decimals: 0 })} · @ {Number(c.balance_fx) ? formatRate(Number(c.balance_inr) / Number(c.balance_fx)) : "—"}</div>}
                </span>
              </li>
            ))}
          </ul>
          <div className="border-t border-sky-50 px-4 py-2.5 text-sm text-slate-600">Altogether <b>{formatINR(totalHeld, { decimals: 0 })}</b> in rupees. <span className="text-xs text-slate-500">Foreign currency here is mostly owed to clients — it is not free money.</span></div>
        </Card>

        <Card title="Who owes us" icon="fa-inbox" padded={false} actions={<LinkButton href="/reports/ageing" variant="ghost">Ageing</LinkButton>}>
          {oweUs.length === 0 ? <p className="px-4 py-5 text-sm text-slate-500">Nobody — every client has paid.</p> : (
            <ul className="divide-y divide-sky-50">
              {oweUs.map((b) => (
                <li key={b.party_id + b.account_code} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <Link href={`/parties/${b.party_id}`} className="font-semibold text-slate-800 hover:text-sky-700">{b.full_name}</Link>
                  <span className="flex items-center gap-2"><b className="tabular-nums">{formatINR(b.balance_inr, { decimals: 0 })}</b>
                    <Link href={`/receipts/new?client=${b.party_id}`} className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800 hover:bg-emerald-200">Collect</Link></span>
                </li>
              ))}
            </ul>
          )}
          {advances.length > 0 && <div className="border-t border-sky-50 px-4 py-2 text-xs text-slate-500">Paid in advance: {advances.map((a) => `${a.full_name} ${formatINR(-Number(a.balance_inr), { decimals: 0 })}`).join(" · ")}</div>}
          <div className="border-t border-sky-50 px-4 py-2.5 text-sm text-slate-600">Total <b>{formatINR(d.totals.to_collect, { decimals: 0 })}</b></div>
        </Card>

        <Card title="Whom we owe" icon="fa-hand-holding-dollar" padded={false} actions={<LinkButton href="/reports/partybalances" variant="ghost">All balances</LinkButton>}>
          <ul className="divide-y divide-sky-50">
            {weOweDep.map((b) => (
              <li key={"d" + b.party_id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span><Link href={`/parties/${b.party_id}`} className="font-semibold text-slate-800 hover:text-sky-700">{b.full_name}</Link> <span className="text-xs text-slate-500">depositor</span></span>
                <span className="flex items-center gap-2"><span className="text-right tabular-nums"><b>{Number(b.balance_fx) ? `${formatQty(-Number(b.balance_fx))} ${b.currency_code.trim()}` : formatINR(-Number(b.balance_inr), { decimals: 0 })}</b>{Number(b.balance_fx) ? <div className="text-xs text-slate-500">carried at {formatINR(-Number(b.balance_inr), { decimals: 0 })}</div> : null}</span>
                  <Link href={`/settlements/new?depositor=${b.party_id}`} className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-bold text-sky-800 hover:bg-sky-200">Pay</Link></span>
              </li>
            ))}
            {weOweCur.map((b) => (
              <li key={"c" + b.party_id + b.currency_code} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span><Link href={`/parties/${b.party_id}`} className="font-semibold text-slate-800 hover:text-sky-700">{b.full_name}</Link> <span className="text-xs text-slate-500">currency to hand over</span></span>
                <span className="flex items-center gap-2"><span className="text-right tabular-nums"><b>{formatQty(-Number(b.balance_fx))} {b.currency_code.trim()}</b><div className="text-xs text-slate-500">{formatINR(-Number(b.balance_inr), { decimals: 0 })}</div></span>
                  <Link href={`/payouts/new?due=${b.party_id}:${b.currency_code.trim()}`} className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800 hover:bg-amber-200">Hand over</Link></span>
              </li>
            ))}
            {weOweDep.length + weOweCur.length === 0 && <li className="px-4 py-5 text-sm text-slate-500">Nobody — every depositor is paid and every client has their currency.</li>}
          </ul>
        </Card>
      </div>
      <p className="text-xs text-slate-500"><Icon name="fa-circle-info" className="mr-1" />Currency owed and rupees owed are two separate balances — neither cancels the other. Profit for the year is under <Link href="/reports/profitloss" className="text-sky-700 hover:underline">Reports → Profit &amp; loss</Link>.</p>
    </div>
  );
}
