"use client";

import { useState } from "react";
import { postPayoutAction } from "@/app/actions/clients";
import { useFormAction } from "@/components/useFormAction";
import { Field, Icon, Note, SelectField } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { formatINR, formatQty } from "@/lib/money";

export type DueRow = { party_id: string; full_name: string; currency_code: string; fx_due: string; inr_value: string };
export type CashRow = { code: string; name: string; currency_code: string; balance_fx: string };

const n = (v: string) => (v && !Number.isNaN(Number(v)) ? Number(v) : 0);

/**
 * Currency out. What is picked is a *debt*, not a client — a client owed two currencies has
 * two rows here — and the form never lets more leave than is owed or than the desk holds.
 */
export function PayoutForm({ due, cash, today, preselect }: { due: DueRow[]; cash: CashRow[]; today: string; preselect?: string }) {
  const [state, onSubmit, pending] = useFormAction<ActionState>(postPayoutAction, {});
  const key = (d: DueRow) => `${d.party_id}:${d.currency_code}`;
  const [picked, setPicked] = useState(preselect && due.some((d) => key(d) === preselect) ? preselect : "");
  const [amount, setAmount] = useState("");

  const row = due.find((d) => key(d) === picked);
  const owed = Number(row?.fx_due ?? 0);
  const giving = n(amount);
  const left = Math.round((owed - giving) * 10000) / 10000;
  const accounts = cash.filter((c) => !row || c.currency_code.trim() === row.currency_code);
  const held = accounts.reduce((a, c) => a + Number(c.balance_fx), 0);
  const tooMuch = !!row && giving > owed + 0.00005;
  const noStock = !!row && giving > held + 0.00005;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {state.error && <Note tone="rose" icon="fa-circle-exclamation"><span className="whitespace-pre-line">{state.error}</span></Note>}

      <div className="grid md:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">What is being handed over <span className="text-rose-500">*</span></span>
          <select value={picked} onChange={(e) => { setPicked(e.target.value); setAmount(""); }} required
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200">
            <option value="">Choose a client and currency…</option>
            {due.map((d) => (
              <option key={key(d)} value={key(d)}>{d.full_name} — {formatQty(d.fx_due)} {d.currency_code} owed</option>
            ))}
          </select>
          <input type="hidden" name="clientId" value={row?.party_id ?? ""} />
          <input type="hidden" name="currency" value={row?.currency_code ?? ""} />
        </label>
        <Field label="Date" name="date" type="date" required defaultValue={today} />
      </div>

      {row && (
        <div className="grid sm:grid-cols-3 gap-3 rounded-xl border border-sky-100 bg-sky-50/60 px-4 py-3 text-sm">
          <Stat label="We owe them" value={`${formatQty(owed)} ${row.currency_code}`} note={`booked at ${formatINR(row.inr_value, { decimals: 0 })}`} />
          <Stat label="Handing over" value={`${formatQty(giving)} ${row.currency_code}`} tone="sky" />
          <Stat label="Still to deliver" value={`${formatQty(Math.max(left, 0))} ${row.currency_code}`} tone={left < 0 ? "rose" : "slate"} />
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-3">
        <Field label="Amount" name="fxAmount" required inputMode="decimal" placeholder="0.00"
          value={amount} onChange={(e) => setAmount(e.target.value)}
          suffix={row && owed > 0 ? (
            <button type="button" onClick={() => setAmount(String(owed))} className="text-xs font-medium text-sky-700 hover:underline">All of it</button>
          ) : undefined} />
        <SelectField label="Out of" name="accountCode"
          options={accounts.map((a) => ({ value: a.code, label: `${a.name} — ${formatQty(a.balance_fx)}` }))}
          hint={row ? `${formatQty(held)} ${row.currency_code} in hand` : "pick the client first"} />
        <Field label="Reference no." name="referenceNo" placeholder="SWIFT / cash memo" />
      </div>
      <Field label="Narration" name="narration" placeholder="Anything worth remembering about this delivery" />

      {tooMuch && <Note tone="amber" icon="fa-triangle-exclamation">We owe {row?.full_name} only {formatQty(owed)} {row?.currency_code}.</Note>}
      {!tooMuch && noStock && (
        <Note tone="amber" icon="fa-triangle-exclamation">
          Only {formatQty(held)} {row?.currency_code} in hand. Book a deal to buy more before handing this over.
        </Note>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || !row || giving <= 0 || tooMuch || noStock}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
          <Icon name={pending ? "fa-spinner fa-spin" : "fa-money-bill-transfer"} />Hand it over
        </button>
        <span className="text-xs text-slate-500">Part deliveries are fine — whatever is left stays on the client&apos;s currency track.</span>
      </div>
    </form>
  );
}

function Stat({ label, value, note, tone = "slate" }: { label: string; value: string; note?: string; tone?: "slate" | "sky" | "rose" }) {
  const colour = tone === "sky" ? "text-sky-800" : tone === "rose" ? "text-rose-700" : "text-slate-800";
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${colour}`}>{value}</div>
      {note && <div className="text-xs text-slate-500">{note}</div>}
    </div>
  );
}
