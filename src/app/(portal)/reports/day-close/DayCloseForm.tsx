"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { dayCloseAction } from "@/app/actions/day";
import { useFormAction } from "@/components/useFormAction";
import { Icon, Note, cn } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { formatINR, formatQty, formatRate } from "@/lib/money";
import type { DayClose } from "@/server/services/day";

/**
 * Sheets 2 and 4 of the client's Excel on one page: type the closing rate for each currency
 * held, see the stock valued, the rupee drawers, and the day's result. The rates live in this
 * form and nowhere else.
 */
export function DayCloseForm({ initial, date }: { initial: DayClose; date: string }) {
  const [state, onSubmit, pending] = useFormAction<ActionState>(dayCloseAction, {});
  const result = useMemo<DayClose>(() => (state.ok && state.data?.json ? (JSON.parse(state.data.json) as DayClose) : initial), [state, initial]);
  const [rates, setRates] = useState<Record<string, string>>({});
  const fieldCls = "w-28 rounded-lg border-2 border-amber-400 bg-amber-50 px-2 py-1.5 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-200";
  const res = Number(result.day.result);

  return (
    <form onSubmit={onSubmit} className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <input type="hidden" name="date" value={date} />
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div><div className="font-semibold text-slate-900">Stock at close — type today&rsquo;s closing rates</div><div className="text-xs text-slate-500">Rates are used for this page and forgotten. Tomorrow&rsquo;s lines start with empty boxes.</div></div>
          <button type="submit" disabled={pending} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-50"><Icon name={pending ? "fa-spinner fa-spin" : "fa-calculator"} className="mr-1" />Value the stock</button>
        </div>
        {state.error && <div className="px-4 pt-3"><Note tone="rose">{state.error}</Note></div>}
        <table className="w-full text-sm tabular-nums">
          <thead className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <tr><th className="px-4 py-2 text-left">Currency</th><th className="px-2 py-2 text-right">Held</th><th className="px-2 py-2 text-right">Carried at</th><th className="px-2 py-2 text-right">Closing rate ₹</th><th className="px-4 py-2 text-right">Value ₹</th></tr>
          </thead>
          <tbody>
            {result.stock.map((r) => (
              <tr key={r.currency} className="border-t border-slate-100">
                <td className="px-4 py-2 font-semibold text-slate-800">{r.currency}<div className="text-[11px] font-normal text-slate-500">{Number(r.owedToClientsFx) > 0 && `${formatQty(r.owedToClientsFx)} owed to clients`}{Number(r.owedToClientsFx) > 0 && Number(r.owedToDepositorsFx) > 0 && " · "}{Number(r.owedToDepositorsFx) > 0 && `${formatQty(r.owedToDepositorsFx)} owed to depositors`}</div></td>
                <td className="px-2 py-2 text-right">{formatQty(r.fx)}</td>
                <td className="px-2 py-2 text-right text-slate-600">{formatINR(r.carriedInr, { decimals: 0 })}<div className="text-[11px] text-slate-400">{r.carriedRate ? `@ ${formatRate(r.carriedRate)}` : ""}</div></td>
                <td className="px-2 py-2 text-right"><input name={`rate:${r.currency}`} inputMode="decimal" value={rates[r.currency] ?? r.rate ?? ""} onChange={(e) => setRates((x) => ({ ...x, [r.currency]: e.target.value }))} placeholder="type" className={fieldCls} /></td>
                <td className={cn("px-4 py-2 text-right font-semibold", r.valueInr ? "text-slate-900" : "text-slate-300")}>{r.valueInr ? formatINR(r.valueInr, { decimals: 0 }) : "—"}</td>
              </tr>
            ))}
            {result.rupees.map((r) => (
              <tr key={r.code} className="border-t border-slate-100 text-slate-700">
                <td className="px-4 py-2 font-semibold">₹ {r.name.replace(/ — .*$/, "")}</td><td className="px-2 py-2 text-right">{formatINR(r.inr, { decimals: 0, symbol: false })}</td><td className="px-2 py-2 text-right text-slate-400">—</td><td className="px-2 py-2 text-right text-slate-400">1</td><td className="px-4 py-2 text-right font-semibold">{formatINR(r.inr, { decimals: 0 })}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-sky-200 bg-sky-50 font-bold text-slate-900">
              <td className="px-4 py-2" colSpan={2}>Everything at close</td>
              <td className="px-2 py-2 text-right">{formatINR(Number(result.totals.carriedInr) + result.rupees.reduce((a, r) => a + Number(r.inr), 0), { decimals: 0 })}</td>
              <td />
              <td className="px-4 py-2 text-right">{result.totals.valueInr ? formatINR(Number(result.totals.valueInr) + result.rupees.reduce((a, r) => a + Number(r.inr), 0), { decimals: 0 }) : "type every rate"}</td>
            </tr>
          </tfoot>
        </table>
        {result.totals.unrealised && (
          <p className="px-4 py-3 text-xs text-slate-600">At these rates the foreign currency is worth <b>{formatINR(result.totals.valueInr!, { decimals: 0 })}</b> against <b>{formatINR(result.totals.carriedInr, { decimals: 0 })}</b> in the books — {Number(result.totals.unrealised) >= 0 ? "up" : "down"} <b>{formatINR(Math.abs(Number(result.totals.unrealised)), { decimals: 0 })}</b>. That is unrealised: it is booked only when the books are restated (Year end → Revalue), not here.</p>
        )}
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="font-semibold text-slate-900">Today&rsquo;s result</div>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-slate-600">Margin on sales{Number(result.day.margin) < 0 && " (loss)"}</dt><dd className={cn("font-semibold tabular-nums", Number(result.day.margin) < 0 ? "text-rose-700" : "text-emerald-700")}>{Number(result.day.margin) < 0 ? "−" : "+"}{formatINR(Math.abs(Number(result.day.margin)))}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">Other income</dt><dd className="font-semibold tabular-nums text-emerald-700">+{formatINR(result.day.otherIncome)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">Expenses</dt><dd className="font-semibold tabular-nums text-rose-700">−{formatINR(result.day.expenses)}</dd></div>
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base"><dt className="font-bold text-slate-900">Day&rsquo;s result</dt><dd className={cn("font-extrabold tabular-nums", res < 0 ? "text-rose-700" : "text-emerald-700")}>{res < 0 ? "−" : ""}{formatINR(Math.abs(res))}</dd></div>
          </dl>
          <p className="mt-2 text-xs text-slate-500">{result.day.vouchers} {result.day.vouchers === 1 ? "line" : "lines"} on the board. Margin is what the sales earned over what the currency cost; the rate move on the stock above is not in it.</p>
        </div>
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
          <b>Where the rest is.</b> The balance sheet as at this date — every currency at its carried value, ₹ cash and bank, what clients have paid in advance, what depositors are owed — is <Link href={`/reports/balancesheet?to=${date}`} className="font-semibold text-sky-700 hover:underline">Reports → Balance sheet</Link>; the year&rsquo;s profit is <Link href="/reports/profitloss" className="font-semibold text-sky-700 hover:underline">Profit &amp; loss</Link>. To make these closing rates the books&rsquo; own, use <Link href="/admin/year-end" className="font-semibold text-sky-700 hover:underline">Year end → Revalue</Link> (needs the year-end permission) — that posts one revaluation voucher; this page posts nothing.
        </div>
      </div>
    </form>
  );
}
