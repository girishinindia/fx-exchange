"use client";

import { useState } from "react";
import { revalueAction } from "@/app/actions/yearend";
import { useFormAction } from "@/components/useFormAction";
import { Field, Icon, Note } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { formatINR, formatQty , formatRate } from "@/lib/money";
import type { OpenPosition } from "@/server/services/yearend";

const n = (v: string) => (v && !Number.isNaN(Number(v)) ? Number(v) : 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Closing rates, and what they do to the books before anything is posted.
 * Currency held and currency owed to clients are both restated, so a position that is matched
 * — the euros held against the euros promised — shows no gain, which is the honest answer.
 */
export function RevalueForm({ positions, baseCurrency, today }: { positions: OpenPosition[]; baseCurrency: string; today: string }) {
  const [state, onSubmit, pending] = useFormAction<ActionState>(revalueAction, {});
  const [rates, setRates] = useState<Record<string, string>>({});

  const preview = positions.map((p) => {
    const rate = n(rates[p.currency_code] ?? "");
    const heldNow = r2(Number(p.held_fx) * rate);
    const owedNow = r2(Number(p.owed_fx) * rate);
    const change = rate > 0 ? r2((heldNow - Number(p.held_inr)) - (owedNow - Number(p.owed_inr))) : 0;
    return { p, rate, heldNow, owedNow, change };
  });
  const total = r2(preview.reduce((a, x) => a + x.change, 0));
  const anyRate = preview.some((x) => x.rate > 0);

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {state.error && <Note tone="rose" icon="fa-circle-exclamation"><span className="whitespace-pre-line">{state.error}</span></Note>}
      {state.ok && <Note tone="emerald" icon="fa-circle-check">{state.message}</Note>}

      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Closing date" name="date" type="date" required defaultValue={today}
          hint="31 March, normally — the last day of the financial year" />
        <Field label="Narration" name="narration" placeholder="Why these rates — the source and the time of day" />
      </div>

      <div className="overflow-x-auto rounded-xl border border-sky-100">
        <table className="w-full text-sm">
          <thead className="bg-sky-50/70 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Currency</th>
              <th className="px-3 py-2 text-right font-semibold">Held</th>
              <th className="px-3 py-2 text-right font-semibold">Owed to clients</th>
              <th className="px-3 py-2 text-right font-semibold">Carried at</th>
              <th className="px-3 py-2 text-right font-semibold">Closing rate</th>
              <th className="px-3 py-2 text-right font-semibold">Gain / loss (₹)</th>
            </tr>
          </thead>
          <tbody>
            {preview.map(({ p, rate, change }) => (
              <tr key={p.currency_code} className="border-t border-sky-50">
                <td className="px-3 py-2 font-medium">{p.currency_code}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatQty(p.held_fx)}
                  <div className="text-xs text-slate-500">{formatINR(p.held_inr, { decimals: 0 })}</div></td>
                <td className="px-3 py-2 text-right tabular-nums">{formatQty(p.owed_fx)}
                  <div className="text-xs text-slate-500">{formatINR(p.owed_inr, { decimals: 0 })}</div></td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{p.carrying_rate ? formatRate(p.carrying_rate) : "—"}</td>
                <td className="px-3 py-2 text-right w-32">
                  <input name={`rate-${p.currency_code}`} value={rates[p.currency_code] ?? ""} inputMode="decimal"
                    placeholder={p.carrying_rate ? formatRate(p.carrying_rate) : "0.00"}
                    onChange={(e) => setRates((s) => ({ ...s, [p.currency_code]: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-sky-200" />
                </td>
                <td className={`px-3 py-2 text-right tabular-nums ${change < 0 ? "text-rose-700" : change > 0 ? "text-emerald-700" : "text-slate-400"}`}>
                  {rate > 0 ? formatINR(change) : "—"}
                </td>
              </tr>
            ))}
            {positions.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                No foreign currency is held or owed. There is nothing to restate.
              </td></tr>
            )}
          </tbody>
          {anyRate && (
            <tfoot className="border-t border-sky-100 bg-sky-50/70 font-semibold">
              <tr>
                <td colSpan={5} className="px-3 py-2 text-right text-slate-600">
                  {total < 0 ? "Unrealised loss" : total > 0 ? "Unrealised gain" : "No gain or loss — the position is matched"}
                </td>
                <td className={`px-3 py-2 text-right tabular-nums ${total < 0 ? "text-rose-700" : "text-emerald-700"}`}>{formatINR(total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <Note icon="fa-lightbulb">
        Euros held against euros promised to a client move together, so a matched position shows no gain however the
        rate has changed. What shows up here is the company&apos;s own exposure — currency it holds beyond what it owes,
        or owes beyond what it holds. It goes to <b>Unrealised Exchange Gain/Loss</b> in {baseCurrency} and stays there
        until the money actually moves.
      </Note>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || !anyRate}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
          <Icon name={pending ? "fa-spinner fa-spin" : "fa-scale-balanced"} />Restate at these rates
        </button>
        <span className="text-xs text-slate-500">Posts one revaluation voucher. Like every other voucher, it can be reversed but never edited.</span>
      </div>
    </form>
  );
}
