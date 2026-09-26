"use client";

import { useState } from "react";
import { postSimpleOpeningAction } from "@/app/actions/opening";
import { useFormAction } from "@/components/useFormAction";
import { Field, Icon, Note } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { formatINR } from "@/lib/money";

const n = (v: string) => (v && !Number.isNaN(Number(v)) ? Number(v) : 0);

/**
 * What did the company start with?
 *
 * One line per currency the company deals in. Rupees need only an amount. Anything else needs
 * the rate it was acquired at, because that rate is what it will cost when a deal sells it —
 * the same rule every deposit follows. The total is shown as it is typed, and posts as one
 * voucher the moment the person is happy with it.
 */
export function SimpleOpeningForm({
  currencies, baseCurrency, primaryCurrency, today,
}: {
  currencies: { code: string; name: string }[];
  baseCurrency: string; primaryCurrency: string; today: string;
}) {
  const [state, onSubmit, pending] = useFormAction<ActionState>(postSimpleOpeningAction, {});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [rates, setRates] = useState<Record<string, string>>({});

  // rupees first, then the dealing currency, then the rest
  const ordered = [...currencies].sort((a, b) =>
    (a.code === baseCurrency ? 0 : a.code === primaryCurrency ? 1 : 2) - (b.code === baseCurrency ? 0 : b.code === primaryCurrency ? 1 : 2)
    || a.code.localeCompare(b.code));

  const rows = ordered.map((c) => {
    const amount = n(amounts[c.code] ?? "");
    const rate = c.code === baseCurrency ? 1 : n(rates[c.code] ?? "");
    const inr = Math.round(amount * rate * 100) / 100;
    const missingRate = c.code !== baseCurrency && amount > 0 && rate <= 0;
    return { ...c, amount, rate, inr, missingRate };
  });
  const total = rows.reduce((a, r) => a + r.inr, 0);
  const anything = rows.some((r) => r.amount > 0);
  const blocked = rows.some((r) => r.missingRate);

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {state.error && <Note tone="rose" icon="fa-circle-exclamation"><span className="whitespace-pre-line">{state.error}</span></Note>}
      {state.ok && <Note tone="emerald" icon="fa-circle-check">{state.message}</Note>}

      <div className="grid md:grid-cols-2 gap-3">
        <Field label="As at" name="date" type="date" required defaultValue={today} hint="The day the company starts on FX Desk." />
        <Field label="Note" name="narration" placeholder="Opening balance as at 1 April 2026" />
      </div>

      <div className="overflow-x-auto rounded-xl border border-sky-100">
        <table className="w-full text-sm">
          <thead className="bg-sky-50/70">
            <tr>
              {["Currency", "In hand", `Acquired at — 1 unit in ${baseCurrency}`, `Worth in ${baseCurrency}`].map((h, i) => (
                <th key={h} className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 ${i ? "text-right" : "text-left"}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.code} className="border-t border-sky-50">
                <td className="px-4 py-2.5">
                  <input type="hidden" name={`row.${i}.currency`} value={r.code} />
                  <span className="font-semibold">{r.code}</span>
                  <span className="ml-2 text-xs text-slate-500">{r.name}</span>
                  {r.code === baseCurrency && <span className="ml-2 text-[11px] text-slate-400">books</span>}
                  {r.code === primaryCurrency && <span className="ml-2 text-[11px] text-slate-400">dealing</span>}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <input name={`row.${i}.amount`} inputMode="decimal" placeholder="0.00"
                    value={amounts[r.code] ?? ""} onChange={(e) => setAmounts({ ...amounts, [r.code]: e.target.value })}
                    className="w-36 rounded-lg border border-slate-200 px-2.5 py-1.5 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-sky-200" />
                </td>
                <td className="px-4 py-2.5 text-right">
                  {r.code === baseCurrency ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <input name={`row.${i}.rate`} inputMode="decimal" placeholder="0.00"
                      value={rates[r.code] ?? ""} onChange={(e) => setRates({ ...rates, [r.code]: e.target.value })}
                      className={`w-32 rounded-lg border px-2.5 py-1.5 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-sky-200 ${r.missingRate ? "border-amber-400 bg-amber-50" : "border-slate-200"}`} />
                  )}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{r.amount > 0 ? formatINR(r.inr) : <span className="text-slate-300">—</span>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-sky-100 bg-sky-50/40">
              <td className="px-4 py-2.5 font-semibold" colSpan={3}>The company starts with</td>
              <td className="px-4 py-2.5 text-right text-lg font-semibold tabular-nums text-sky-800">{formatINR(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {blocked && (
        <Note tone="amber" icon="fa-triangle-exclamation">
          Foreign currency needs the rate it was acquired at. It is not a valuation for today — it is what that currency will cost when a deal sells it, so it has to be what you actually paid.
        </Note>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || !anything || blocked}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
          <Icon name={pending ? "fa-spinner fa-spin" : "fa-flag-checkered"} />Open the books with this
        </button>
        <span className="text-xs text-slate-500">
          Posted once, then locked. {!anything && "If the company starts with nothing, there is nothing to post — go straight to Deposits."}
        </span>
      </div>
    </form>
  );
}
