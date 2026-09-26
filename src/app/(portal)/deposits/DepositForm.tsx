"use client";

import { useState } from "react";
import { postDepositAction } from "@/app/actions/deposits";
import { useFormAction } from "@/components/useFormAction";
import { Field, Icon, Note, SelectField } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { formatINR, formatQty } from "@/lib/money";

export type DepositorOpt = {
  id: string; full_name: string; party_code: string;
  /** what the promise is carried at in the books */
  outstanding_inr: string;
  /** what is actually owed, and in what — the rupees are only its valuation */
  outstanding_fx: string; outstanding_currency: string | null;
};

const n = (v: string) => (v && !Number.isNaN(Number(v)) ? Number(v) : 0);

/**
 * Currency in.
 *
 * Most deposits are in the currency the desk deals in and nothing but an amount and a rate is
 * asked for. A depositor who hands over something else — euros, dirhams — adds one more rate:
 * how many dollars one of those buys. The desk ends up holding dollars either way, and owes
 * the depositor dollars either way; the other currency came in and was changed, and the
 * voucher says so in as many words.
 */
export function DepositForm({
  depositors, currencies, primaryCurrency, baseCurrency, today,
}: {
  depositors: DepositorOpt[];
  /** every currency this company deals in, so a depositor may hand over any of them */
  currencies: { code: string; name: string }[];
  primaryCurrency: string; baseCurrency: string; today: string;
}) {
  const [state, onSubmit, pending] = useFormAction<ActionState>(postDepositAction, {});
  const [currency, setCurrency] = useState(primaryCurrency);
  const [fx, setFx] = useState("");
  const [conv, setConv] = useState("");
  const [rate, setRate] = useState("");
  const [depositorId, setDepositorId] = useState("");

  const asPrimary = currency === primaryCurrency;
  const dollars = asPrimary ? n(fx) : Math.round(n(fx) * n(conv) * 10000) / 10000;
  const inr = Math.round(dollars * n(rate) * 100) / 100;
  const chosen = depositors.find((d) => d.id === depositorId);
  const owed = Number(chosen?.outstanding_fx ?? 0);
  const owedCur = chosen?.outstanding_currency?.trim() || primaryCurrency;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {state.error && <Note tone="rose" icon="fa-circle-exclamation"><span className="whitespace-pre-line">{state.error}</span></Note>}
      {state.ok && <Note tone="emerald" icon="fa-circle-check">{state.message}</Note>}

      <div className="grid md:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Depositor <span className="text-rose-500">*</span></span>
          <select name="depositorId" required value={depositorId} onChange={(e) => setDepositorId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200">
            <option value="">Choose the depositor…</option>
            {depositors.map((d) => <option key={d.id} value={d.id}>{d.full_name} ({d.party_code})</option>)}
          </select>
          {chosen && (
            <span className="mt-1 block text-xs text-slate-500">
              {owed > 0
                ? <>We already owe {chosen.full_name} <b>{formatQty(owed)} {owedCur}</b>.</>
                : <>Nothing outstanding with {chosen.full_name} right now.</>}
            </span>
          )}
        </label>
        <Field label="Date" name="date" type="date" required defaultValue={today} />
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <SelectField label="Currency handed over" name="currency" value={currency}
          onChange={(e) => { setCurrency(e.target.value); setConv(""); }}
          options={currencies.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))}
          hint={asPrimary ? "What this desk deals in" : `Changed into ${primaryCurrency} on this voucher`} />
        <Field label={`Amount in ${currency}`} name="fxAmount" required inputMode="decimal" placeholder="10000.00"
          value={fx} onChange={(e) => setFx(e.target.value)} hint="What the depositor actually handed over" />
        {asPrimary ? (
          <Field label={`Rate — 1 ${primaryCurrency} in ${baseCurrency}`} name="rate" required inputMode="decimal" placeholder="86.00"
            value={rate} onChange={(e) => setRate(e.target.value)} hint={`Values the ${primaryCurrency} in the books today. It does not decide what the depositor is paid — that rate is agreed on the day you settle them.`} />
        ) : (
          <Field label={`1 ${currency} in ${primaryCurrency}`} name="toPrimaryRate" required inputMode="decimal" placeholder="1.08"
            value={conv} onChange={(e) => setConv(e.target.value)} hint={`How many ${primaryCurrency} one ${currency} buys`} />
        )}
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        {!asPrimary && (
          <Field label={`Rate — 1 ${primaryCurrency} in ${baseCurrency}`} name="rate" required inputMode="decimal" placeholder="86.00"
            value={rate} onChange={(e) => setRate(e.target.value)} hint="What the dollars are worth today" />
        )}
        <div className={`rounded-xl border border-sky-100 bg-sky-50/60 px-4 py-3 ${asPrimary ? "md:col-span-3" : "md:col-span-2"}`}>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">We will owe {chosen?.full_name ?? "the depositor"}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-sky-800">{formatQty(dollars)} {primaryCurrency}</div>
          <div className="text-xs text-slate-500">
            {asPrimary
              ? <>carried at {formatINR(inr)} — {fx || "0"} × {rate || "0"}</>
              : <>{fx || "0"} {currency} × {conv || "0"} = {formatQty(dollars)} {primaryCurrency}, carried at {formatINR(inr)}</>}
          </div>
        </div>
      </div>

      {!asPrimary && (
        <Note tone="slate" icon="fa-right-left">
          The {currency} is written into the books as it arrives and changed to {primaryCurrency} on the same voucher, at the
          rate above — so the day book shows what came through the door, and the desk is never shown holding {primaryCurrency}
          nobody handed it. What {chosen?.full_name ?? "the depositor"} is owed back is {primaryCurrency}.
        </Note>
      )}

      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Reference no." name="referenceNo" placeholder="SWIFT / NEFT / cash memo" />
        <Field label="Rate justification" name="rateJustification" placeholder="Why this rate — for the auditor" />
      </div>
      <Field label="Narration" name="narration" placeholder="Anything worth remembering about this deposit" />

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || inr <= 0 || !depositorId}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
          <Icon name={pending ? "fa-spinner fa-spin" : "fa-down-long"} />Record deposit
        </button>
        <span className="text-xs text-slate-500">
          One voucher. The depositor is owed {primaryCurrency} — what that costs in rupees is settled at the rate you agree on the day you pay them.
        </span>
      </div>
    </form>
  );
}
