"use client";

import { useState } from "react";
import { postReceiptAction } from "@/app/actions/clients";
import { useFormAction } from "@/components/useFormAction";
import { Field, Icon, Note, SelectField } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { formatINR } from "@/lib/money";

export type ClientOwing = { party_id: string; full_name: string; party_code: string; receivable_inr: string };

const n = (v: string) => (v && !Number.isNaN(Number(v)) ? Number(v) : 0);

/**
 * Rupees in. Taking more than the client owes is a typo far more often than an advance, so
 * the extra has to be ticked on purpose — and then it is named an advance, not hidden.
 */
export function ReceiptForm({
  clients, cashAccounts, baseCurrency, today, preselect,
}: {
  clients: ClientOwing[];
  cashAccounts: { code: string; name: string; balance_inr: string }[];
  baseCurrency: string; today: string; preselect?: string;
}) {
  const [state, onSubmit, pending] = useFormAction<ActionState>(postReceiptAction, {});
  const [clientId, setClientId] = useState(preselect ?? "");
  const [amount, setAmount] = useState("");
  const [advance, setAdvance] = useState(false);

  const chosen = clients.find((c) => c.party_id === clientId);
  const owed = Math.max(Number(chosen?.receivable_inr ?? 0), 0);
  const taking = n(amount);
  const extra = Math.round(Math.max(taking - owed, 0) * 100) / 100;
  const left = Math.round((owed - taking) * 100) / 100;
  const needsTick = extra > 0 && !advance;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {state.error && <Note tone="rose" icon="fa-circle-exclamation"><span className="whitespace-pre-line">{state.error}</span></Note>}

      <div className="grid md:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Client <span className="text-rose-500">*</span></span>
          <select name="clientId" required value={clientId} onChange={(e) => { setClientId(e.target.value); setAmount(""); }}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200">
            <option value="">Choose the client…</option>
            {clients.map((c) => (
              <option key={c.party_id} value={c.party_id}>
                {c.full_name} — {Number(c.receivable_inr) > 0 ? `${formatINR(c.receivable_inr, { decimals: 0 })} owed` : "nothing owed"}
              </option>
            ))}
          </select>
        </label>
        <Field label="Date" name="date" type="date" required defaultValue={today} />
      </div>

      {chosen && (
        <div className="grid sm:grid-cols-3 gap-3 rounded-xl border border-sky-100 bg-sky-50/60 px-4 py-3 text-sm">
          <div><div className="text-xs uppercase tracking-wide text-slate-500">They owe</div>
            <div className="text-lg font-semibold tabular-nums text-slate-800">{formatINR(owed)}</div></div>
          <div><div className="text-xs uppercase tracking-wide text-slate-500">Taking now</div>
            <div className="text-lg font-semibold tabular-nums text-sky-800">{formatINR(taking)}</div></div>
          <div><div className="text-xs uppercase tracking-wide text-slate-500">{extra > 0 ? "Advance" : "Still owed after"}</div>
            <div className={`text-lg font-semibold tabular-nums ${extra > 0 ? "text-amber-700" : "text-slate-800"}`}>
              {formatINR(extra > 0 ? extra : Math.max(left, 0))}
            </div></div>
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-3">
        <Field label={`Amount in ${baseCurrency}`} name="inrAmount" required inputMode="decimal" placeholder="0.00"
          value={amount} onChange={(e) => setAmount(e.target.value)}
          suffix={chosen && owed > 0 ? (
            <button type="button" onClick={() => setAmount(owed.toFixed(2))} className="text-xs font-medium text-sky-700 hover:underline">All of it</button>
          ) : undefined} />
        <SelectField label="Into" name="accountCode"
          options={cashAccounts.map((a) => ({ value: a.code, label: `${a.name} — ${formatINR(a.balance_inr, { decimals: 0 })}` }))} />
        <Field label="Reference no." name="referenceNo" placeholder="NEFT / cheque number" />
      </div>
      <Field label="Narration" name="narration" placeholder="Anything worth remembering about this receipt" />

      {extra > 0 && (
        <label className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${advance ? "border-amber-200 bg-amber-50" : "border-rose-200 bg-rose-50"}`}>
          <input type="checkbox" name="allowAdvance" checked={advance} onChange={(e) => setAdvance(e.target.checked)} className="mt-0.5 rounded border-slate-300" />
          <span>
            <b>{formatINR(extra)} more than {chosen?.full_name} owes.</b> Tick this only if they really have paid in
            advance — it will sit on their ledger as a credit until the next deal. Otherwise check the amount.
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || !clientId || taking <= 0 || needsTick}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
          <Icon name={pending ? "fa-spinner fa-spin" : "fa-inbox"} />Record the receipt
        </button>
        <span className="text-xs text-slate-500">These rupees are what settles the depositors.</span>
      </div>
    </form>
  );
}
