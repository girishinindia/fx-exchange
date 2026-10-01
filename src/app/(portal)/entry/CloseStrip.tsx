"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon, cn } from "@/components/ui";
import { formatINR, formatQty } from "@/lib/money";
import type { DayCell, DayColumn, DaySheet } from "@/server/services/day";

/**
 * The bottom of the whiteboard: a closing rate per currency, typed here and nowhere else, and
 * the stock valued at it. The arithmetic runs in the browser — no rate leaves the page, none is
 * stored, and tomorrow the boxes are empty again. Restating the books at these rates is the
 * year-end revaluation, one link away for those allowed to.
 */
export function CloseStrip({ columns, closing, day, date, canRevalue }: { columns: DayColumn[]; closing: Record<string, DayCell>; day: DaySheet["day"]; date: string; canRevalue: boolean }) {
  const [rates, setRates] = useState<Record<string, string>>({});
  const num = (v: string) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  const fxCols = columns.filter((c) => !c.isBase);
  const allTyped = fxCols.every((c) => num(rates[c.code] ?? "") > 0 || Number(closing[c.code]?.fx ?? 0) === 0);
  const value = (c: DayColumn) => (c.isBase ? Number(closing[c.code]?.inr ?? 0) : Number(closing[c.code]?.fx ?? 0) * num(rates[c.code] ?? ""));
  const total = columns.reduce((a, c) => a + value(c), 0);
  const carried = columns.reduce((a, c) => a + Number(closing[c.code]?.inr ?? 0), 0);
  const result = Number(day.result);

  return (
    <div className="mt-1 rounded-b-xl border-t border-amber-200 bg-amber-50/60 px-2 py-2 text-[13px]">
      <div className="grid gap-x-3 gap-y-2 md:grid-cols-[auto_1fr_auto] md:items-center">
        <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">Closing rate ₹ <span className="block text-[10px] font-normal normal-case text-amber-700">typed at day end · not kept</span></div>
        <div className="flex flex-wrap items-center gap-2">
          {fxCols.map((c) => {
            const fx = Number(closing[c.code]?.fx ?? 0);
            return (
              <label key={c.code} className={cn("flex items-center gap-1 rounded-lg border bg-white px-2 py-1", fx === 0 ? "border-slate-200 opacity-60" : "border-amber-300")}>
                <span className="text-xs font-bold text-slate-700">{c.currency}</span>
                <input inputMode="decimal" value={rates[c.code] ?? ""} onChange={(e) => setRates((r) => ({ ...r, [c.code]: e.target.value }))} placeholder="rate" disabled={fx === 0}
                  className="w-20 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-right text-xs tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-200" />
                <span className="w-24 text-right text-xs tabular-nums text-slate-600">{num(rates[c.code] ?? "") ? formatINR(fx * num(rates[c.code] ?? ""), { decimals: 2 }) : fx ? `${formatQty(fx)} ${c.currency}` : "—"}</span>
              </label>
            );
          })}
          {fxCols.length === 0 && <span className="text-xs text-slate-500">No foreign currency held at close.</span>}
        </div>
        <div className="text-right text-xs text-slate-700">
          <div>Value at close: <b className="text-[14px] text-slate-900">{allTyped ? formatINR(total, { decimals: 2 }) : "type every rate"}</b></div>
          <div className="text-slate-500">carried in the books at {formatINR(carried, { decimals: 2 })}{allTyped ? <> · {total - carried >= 0 ? "up" : "down"} {formatINR(Math.abs(total - carried), { decimals: 2 })} at these rates</> : null}</div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-amber-100 pt-2 text-xs text-slate-700">
        <span><b>Today&rsquo;s result</b> <span className={cn("font-bold", result < 0 ? "text-rose-700" : "text-emerald-700")}>{result < 0 ? "−" : ""}{formatINR(Math.abs(result))}</span></span>
        <span>margin {Number(day.margin) < 0 ? "−" : ""}{formatINR(Math.abs(Number(day.margin)))}</span>
        {Number(day.otherIncome) !== 0 && <span>other income {formatINR(day.otherIncome)}</span>}
        <span>expenses {formatINR(day.expenses)}</span>
        <span className="ml-auto flex items-center gap-3">
          <Link href={`/reports/day-close?date=${date}`} className="font-semibold text-sky-700 hover:underline"><Icon name="fa-moon" className="mr-1" />Day close</Link>
          {canRevalue && <Link href="/admin/year-end" className="text-slate-500 hover:underline">restate the books at closing rates</Link>}
        </span>
      </div>
    </div>
  );
}
