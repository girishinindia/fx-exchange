import type { Metadata } from "next";
import Link from "next/link";
import { Card, Icon, Kpi, LinkButton, Note } from "@/components/ui";
import { getCompanyInfo } from "@/lib/company";
import { todayISO } from "@/lib/format";
import { formatINR, formatQty } from "@/lib/money";
import { getPermissions } from "@/lib/permissions";
import { requireSession } from "@/lib/session";
import { todo } from "@/server/services/counter";
import { liquidity, listVouchers } from "@/server/services/ledger";
import { TodoList } from "./TodoList";

export const metadata: Metadata = { title: "Home" };

/**
 * The Simple portal's home: three numbers, two big buttons, and the to-do list — every
 * open hand-over, collection and payment as one button each. The full dashboard is a
 * click away for anybody who wants the twelve figures.
 */
export default async function SimpleHome() {
  const s = await requireSession();
  if (s.preview) return <Note tone="amber">Needs a real login.</Note>;
  const perms = await getPermissions(s);
  const company = await getCompanyInfo(s);
  if (!perms.has("report.view")) {
    return (
      <div className="space-y-6">
        <BigButtons canSell={perms.has("deal.manage")} canBuy={perms.has("voucher.create")} />
        <Note>Your account posts entries but does not see balances. Ask Genius ITens for the reports permission if you need them.</Note>
      </div>
    );
  }
  const [d, open, recent] = await Promise.all([liquidity(s), todo(s), listVouchers(s, { from: todayISO(), to: todayISO(), limit: 8 })]);
  const cashInr = d.cash.filter((c) => c.currency_code.trim() === company.baseCurrency).reduce((a, c) => a + Number(c.balance_inr), 0);
  const held = d.cash.filter((c) => c.currency_code.trim() !== company.baseCurrency && Number(c.balance_fx) !== 0);
  const owedFx = open.items.filter((i) => i.kind === "PAY").reduce((a, i) => a + Number(i.fxAmount ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Cash in hand" value={formatINR(cashInr, { decimals: 0 })} icon="fa-wallet" tone="sky"
             sub={held.length ? `+ ${held.map((c) => `${formatQty(c.balance_fx)} ${c.currency_code.trim()}`).join(" · ")}` : "no foreign currency held"} />
        <Kpi label="Clients owe us" value={formatINR(d.totals.to_collect, { decimals: 0 })} icon="fa-inbox" tone="emerald"
             sub={`${open.items.filter((i) => i.kind === "COLLECT").length} client${open.items.filter((i) => i.kind === "COLLECT").length === 1 ? "" : "s"} still to pay`} />
        <Kpi label="We owe depositors" value={owedFx ? `${formatQty(owedFx)} ${company.primaryCurrency}` : "—"} icon="fa-hand-holding-dollar" tone="amber"
             sub={owedFx ? `carried at ${formatINR(d.totals.owed_to_depositors, { decimals: 0 })}` : "everybody is settled"} />
      </div>

      <BigButtons canSell={perms.has("deal.manage")} canBuy={perms.has("voucher.create")} />

      <Card title="To do — one click each" icon="fa-list-check" padded={false}
            actions={<span className="text-xs text-slate-500">{open.items.length} open</span>}>
        {open.items.length === 0
          ? <p className="px-4 py-6 text-sm text-slate-500"><Icon name="fa-circle-check" className="mr-1 text-emerald-600" />Nothing waiting — every client has their currency and has paid, every depositor is settled.</p>
          : <TodoList items={open.items} />}
      </Card>

      <Card title="Today" icon="fa-clock" padded={false} actions={<LinkButton href="/vouchers" variant="ghost">All entries</LinkButton>}>
        {recent.rows.length === 0 ? <p className="px-4 py-5 text-sm text-slate-500">Nothing posted yet today.</p> : (
          <ul className="divide-y divide-sky-50">
            {recent.rows.map((v) => (
              <li key={v.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <Link href={`/vouchers/${v.id}`} className="font-medium text-slate-800 hover:text-sky-700">{v.voucher_no}{v.party_name ? ` · ${v.party_name}` : ""}</Link>
                <span className="tabular-nums text-slate-600">{formatINR(v.total_inr, { decimals: 0 })}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-xs text-slate-500">Want the twelve-figure view? <Link href="/dashboard" className="text-sky-700 hover:underline">Open the full dashboard</Link>.</p>
    </div>
  );
}

function BigButtons({ canSell, canBuy }: { canSell: boolean; canBuy: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Link href="/entry?mode=buy" aria-disabled={!canBuy} className={`rounded-2xl bg-emerald-600 px-6 py-6 text-white shadow hover:bg-emerald-700 ${canBuy ? "" : "pointer-events-none opacity-50"}`}>
        <div className="text-2xl font-extrabold"><Icon name="fa-plus" className="mr-2" />Buy</div>
        <div className="mt-1 text-sm text-emerald-100">currency from a depositor</div>
      </Link>
      <Link href="/entry?mode=sell" aria-disabled={!canSell} className={`rounded-2xl bg-amber-600 px-6 py-6 text-white shadow hover:bg-amber-700 ${canSell ? "" : "pointer-events-none opacity-50"}`}>
        <div className="text-2xl font-extrabold"><Icon name="fa-minus" className="mr-2" />Sell</div>
        <div className="mt-1 text-sm text-amber-100">currency to a client</div>
      </Link>
    </div>
  );
}
