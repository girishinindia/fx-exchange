"use client";

import { useState } from "react";
import { postSettlementAction } from "@/app/actions/deposits";
import { useFormAction } from "@/components/useFormAction";
import { Field, Icon, Note, SelectField } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { formatINR, formatQty, formatRate } from "@/lib/money";
import type { DepositorOpt } from "../deposits/DepositForm";

const n = (v: string) => (v && !Number.isNaN(Number(v)) ? Number(v) : 0);

/**
 * Paying a depositor back.
 *
 * The depositor is owed *currency*, not rupees — USD 20,000, not ₹17,20,000 — so the amount is
 * typed in that currency and the rupee rate is agreed today, like every other rate in this
 * product. The screen shows what the promise is carried at beside what is about to be paid, so
 * the gain or the loss is visible before anybody presses the button rather than turning up in
 * the profit and loss at the end of the month.
 *
 * Every figure here is a preview. The database releases the promise at its carrying rate, pays
 * the rupees at the agreed rate and books the difference itself; nothing below is authoritative.
 */
export function SettlementForm({
  depositors, cashAccounts, baseCurrency, today, rupeesInHand, preselect,
}: {
  depositors: DepositorOpt[];
  cashAccounts: { code: string; name: string; balance_inr: string }[];
  baseCurrency: string; today: string; rupeesInHand: string; preselect?: string;
}) {
  const [state, onSubmit, pending] = useFormAction<ActionState>(postSettlementAction, {});
  const [depositorId, setDepositorId] = useState(preselect ?? "");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");

  const chosen = depositors.find((d) => d.id === depositorId);
  const currency = chosen?.outstanding_currency?.trim() || baseCurrency;
  const inRupees = currency === baseCurrency;

  const owedFx = Number(chosen?.outstanding_fx ?? 0);
  const owedInr = Number(chosen?.outstanding_inr ?? 0);
  const carriedAt = owedFx > 0 ? owedInr / owedFx : 0;

  const payingFx = n(amount);
  const agreed = inRupees ? 1 : n(rate);
  const payingInr = Math.round(payingFx * agreed * 100) / 100;
  const releasing = Math.round(payingFx * carriedAt * 100) / 100;
  const moved = Math.round((releasing - payingInr) * 100) / 100;

  const leftFx = Math.round((owedFx - payingFx) * 10000) / 10000;
  const tooMuch = chosen ? payingFx > owedFx + 0.00004 : false;
  const noCash = payingInr > Number(rupeesInHand) + 0.004;
  const needRate = !inRupees && agreed <= 0;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {state.error && <Note tone="rose" icon="fa-circle-exclamation"><span className="whitespace-pre-line">{state.error}</span></Note>}
      {state.ok && <Note tone="emerald" icon="fa-circle-check">{state.message}</Note>}

      <input type="hidden" name="currency" value={currency} />

      <div className="grid md:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Depositor <span className="text-rose-500">*</span></span>
          <select name="depositorId" required value={depositorId}
            onChange={(e) => { setDepositorId(e.target.value); setAmount(""); setRate(""); }}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200">
            <option value="">Choose the depositor…</option>
            {depositors.filter((d) => Number(d.outstanding_fx) > 0).map((d) => (
              <option key={d.id} value={d.id}>
                {d.full_name} — {formatQty(d.outstanding_fx)} {d.outstanding_currency?.trim() ?? baseCurrency} owed
              </option>
            ))}
          </select>
        </label>
        <Field label="Date" name="date" type="date" required defaultValue={today} />
      </div>

      {chosen && (
        <div className="grid sm:grid-cols-4 gap-3 rounded-xl border border-sky-100 bg-sky-50/60 px-4 py-3 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">We owe</div>
            <div className="text-lg font-semibold tabular-nums text-slate-800">{formatQty(owedFx)} {currency}</div>
            {!inRupees && <div className="text-xs text-slate-500">carried at {formatRate(carriedAt)}</div>}
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Settling now</div>
            <div className="text-lg font-semibold tabular-nums text-sky-800">{formatQty(payingFx)} {currency}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Rupees out</div>
            <div className="text-lg font-semibold tabular-nums text-sky-800">{formatINR(payingInr)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Still owed after</div>
            <div className={`text-lg font-semibold tabular-nums ${leftFx < 0 ? "text-rose-700" : "text-slate-800"}`}>
              {formatQty(Math.max(leftFx, 0))} {currency}
            </div>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-3">
        <Field label={`Amount in ${currency}`} name="fxAmount" required inputMode="decimal" placeholder="0.00"
          value={amount} onChange={(e) => setAmount(e.target.value)}
          suffix={chosen && owedFx > 0 ? (
            <button type="button" onClick={() => setAmount(owedFx.toFixed(2))} className="text-xs font-medium text-sky-700 hover:underline">Settle it all</button>
          ) : undefined} />
        {inRupees ? (
          <input type="hidden" name="rate" value="1" />
        ) : (
          <Field label={`Rate agreed today — 1 ${currency}`} name="rate" required inputMode="decimal" placeholder="0.00"
            value={rate} onChange={(e) => setRate(e.target.value)}
            hint={carriedAt > 0 ? `Carried at ${formatRate(carriedAt)}. Nothing is taken from the deposit — type what you agreed.` : undefined} />
        )}
        <SelectField label="Paid from" name="accountCode"
          options={cashAccounts.map((a) => ({ value: a.code, label: `${a.name} — ${formatINR(a.balance_inr, { decimals: 0 })}` }))}
          hint={`${formatINR(rupeesInHand, { decimals: 0 })} in hand altogether`} />
      </div>

      {!inRupees && payingFx > 0 && agreed > 0 && Math.abs(moved) > 1 && (
        <Note tone={moved > 0 ? "emerald" : "amber"} icon={moved > 0 ? "fa-arrow-trend-up" : "fa-arrow-trend-down"}>
          You are releasing {formatINR(releasing)} of the promise and paying {formatINR(payingInr)}.{" "}
          {moved > 0
            ? <>The rate has moved your way — <b>{formatINR(moved)}</b> goes to FX Margin.</>
            : <>The rate has moved against you — <b>{formatINR(-moved)}</b> goes to Exchange Loss.</>}
        </Note>
      )}

      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Reference no." name="referenceNo" placeholder="NEFT / cheque number" />
        <Field label="Narration" name="narration" placeholder="Anything worth remembering about this payment" />
      </div>

      {tooMuch && <Note tone="amber" icon="fa-triangle-exclamation">That is more than we owe {chosen?.full_name}. Reduce it to {formatQty(owedFx)} {currency} or less.</Note>}
      {!tooMuch && noCash && <Note tone="amber" icon="fa-triangle-exclamation">Only {formatINR(rupeesInHand)} in hand. Collect from clients before settling this much.</Note>}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || payingFx <= 0 || !depositorId || tooMuch || noCash || needRate}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
          <Icon name={pending ? "fa-spinner fa-spin" : "fa-up-long"} />Pay the depositor
        </button>
        <span className="text-xs text-slate-500">Part payments are fine — the balance left is carried on the depositor&apos;s ledger, in {currency}.</span>
      </div>
    </form>
  );
}
