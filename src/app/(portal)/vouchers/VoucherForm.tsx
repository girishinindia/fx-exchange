"use client";

import { useState } from "react";
import { postVoucherAction } from "@/app/actions/vouchers";
import { useFormAction } from "@/components/useFormAction";
import { Field, Icon, Note, SelectField } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { VOUCHER_TYPES, type VoucherType } from "@/lib/ledger";

export type AccountOpt = { id: string; code: string; name: string; currency_code: string | null; is_control: boolean; party_kind: string | null };
export type PartyOpt = { id: string; full_name: string; is_client: boolean; is_depositor: boolean };

type Line = { key: number; account: string; party: string; currency: string; fx: string; rate: string; dc: "D" | "C"; remarks: string };
const blank = (key: number): Line => ({ key, account: "", party: "", currency: "", fx: "", rate: "", dc: "D", remarks: "" });
const n = (v: string) => (v && !Number.isNaN(Number(v)) ? Number(v) : 0);

/**
 * Types a voucher line by line: account, party (for control accounts), currency, amount, manual rate.
 * The rupee value of each line and the running debit / credit totals are shown while typing;
 * the database re-checks everything when the voucher is posted.
 */
export function VoucherForm({
  accounts, parties, baseCurrency, today, fixedType, title,
}: {
  accounts: AccountOpt[]; parties: PartyOpt[]; baseCurrency: string; today: string;
  fixedType?: VoucherType; title?: string;
}) {
  const [state, onSubmit, pending] = useFormAction<ActionState>(postVoucherAction, {});
  const [lines, setLines] = useState<Line[]>([blank(1), blank(2)]);
  const [type, setType] = useState<VoucherType>(fixedType ?? "JOURNAL");

  const accountOf = (id: string) => accounts.find((a) => a.id === id);
  const set = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const inr = (l: Line) => {
    const acc = accountOf(l.account);
    const cur = l.currency || acc?.currency_code?.trim() || baseCurrency;
    const rate = cur === baseCurrency ? 1 : n(l.rate);
    return Math.round(n(l.fx) * rate * 100) / 100;
  };
  const debit = lines.filter((l) => l.dc === "D").reduce((a, l) => a + inr(l), 0);
  const credit = lines.filter((l) => l.dc === "C").reduce((a, l) => a + inr(l), 0);
  const diff = Math.round((debit - credit) * 100) / 100;
  const money = (v: number) => v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cell = "w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200";

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {(state.error || state.fieldErrors) && (
        <Note tone="rose" icon="fa-circle-exclamation">
          <span className="whitespace-pre-line">{state.error ?? Object.entries(state.fieldErrors ?? {}).map(([f, m]) => `${f}: ${m}`).join("\n")}</span>
        </Note>
      )}
      {state.ok && <Note tone="emerald" icon="fa-circle-check">{state.message}</Note>}

      <div className="grid md:grid-cols-4 gap-3">
        {fixedType ? (
          <input type="hidden" name="type" value={fixedType} />
        ) : (
          <SelectField label="Voucher type" name="type" value={type} onChange={(e) => setType(e.target.value as VoucherType)}
            options={(["JOURNAL", "EXPENSE", "DEPOSIT", "DEAL", "PAYOUT", "RECEIPT", "SETTLEMENT"] as VoucherType[]).map((t) => ({ value: t, label: VOUCHER_TYPES[t] }))} />
        )}
        <Field label="Date" name="date" type="date" required defaultValue={today} />
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Party (optional)</span>
          <select name="partyId" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            <option value="">—</option>
            {parties.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </label>
        <Field label="Reference no." name="referenceNo" placeholder="NEFT / cheque / SWIFT" />
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Narration" name="narration" placeholder="What this voucher is for" />
        <Field label="Rate justification" name="rateJustification" placeholder="Why this rate — for the auditor" />
      </div>

      <div className="overflow-x-auto rounded-xl border border-sky-100">
        <table className="w-full text-sm">
          <thead className="bg-sky-50/70">
            <tr>{["Account", "Party", "Currency", "Amount", "Rate", "₹ value", "Dr/Cr", ""].map((h, i) => (
              <th key={h + i} className={`px-2 py-2 text-xs font-semibold uppercase text-slate-500 ${[3, 4, 5].includes(i) ? "text-right" : "text-left"}`}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const acc = accountOf(l.account);
              const cur = l.currency || acc?.currency_code?.trim() || baseCurrency;
              const needsParty = !!acc?.is_control;
              return (
                <tr key={l.key} className="border-t border-sky-50">
                  <td className="px-2 py-1.5 min-w-[220px]">
                    <select name={`line-${i}-account`} value={l.account} onChange={(e) => set(l.key, { account: e.target.value, currency: "" })} className={cell}>
                      <option value="">Choose account…</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.currency_code ? ` (${a.currency_code.trim()})` : ""}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5 min-w-[160px]">
                    <select name={`line-${i}-party`} value={l.party} onChange={(e) => set(l.key, { party: e.target.value })} className={cell} disabled={!needsParty}>
                      <option value="">{needsParty ? "Choose party…" : "—"}</option>
                      {parties
                        .filter((p) => !acc?.party_kind || (acc.party_kind === "CLIENT" ? p.is_client : p.is_depositor))
                        .map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5 w-24">
                    <input name={`line-${i}-currency`} value={cur} onChange={(e) => set(l.key, { currency: e.target.value.toUpperCase() })}
                      readOnly={!!acc?.currency_code} className={`${cell} uppercase ${acc?.currency_code ? "bg-slate-50" : ""}`} />
                  </td>
                  <td className="px-2 py-1.5 w-32"><input name={`line-${i}-fx`} value={l.fx} onChange={(e) => set(l.key, { fx: e.target.value })} inputMode="decimal" placeholder="0.00" className={`${cell} text-right`} /></td>
                  <td className="px-2 py-1.5 w-28">
                    <input name={`line-${i}-rate`} value={cur === baseCurrency ? "1" : l.rate} onChange={(e) => set(l.key, { rate: e.target.value })}
                      inputMode="decimal" placeholder="0.00" readOnly={cur === baseCurrency} className={`${cell} text-right ${cur === baseCurrency ? "bg-slate-50 text-slate-400" : ""}`} />
                  </td>
                  <td className="px-2 py-1.5 w-32 text-right tabular-nums text-slate-600">{money(inr(l))}</td>
                  <td className="px-2 py-1.5 w-24">
                    <select name={`line-${i}-dc`} value={l.dc} onChange={(e) => set(l.key, { dc: e.target.value as "D" | "C" })} className={cell}>
                      <option value="D">Debit</option>
                      <option value="C">Credit</option>
                    </select>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {lines.length > 2 && (
                      <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="text-slate-400 hover:text-rose-600" aria-label="Remove line">
                        <Icon name="fa-trash" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-sky-50/70 border-t border-sky-100">
            <tr className="font-semibold">
              <td colSpan={5} className="px-2 py-2 text-right text-slate-600">Debit {money(debit)} · Credit {money(credit)}</td>
              <td className={`px-2 py-2 text-right tabular-nums ${diff === 0 ? "text-emerald-700" : "text-rose-700"}`}>{diff === 0 ? "Balanced" : `Off by ${money(Math.abs(diff))}`}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setLines((ls) => [...ls, blank(Math.max(...ls.map((x) => x.key)) + 1)])}
          className="rounded-lg border border-sky-200 bg-white px-3 py-2 text-sm font-medium text-sky-700 hover:bg-sky-50">
          <Icon name="fa-plus" className="mr-1" />Add line
        </button>
        <button type="submit" disabled={pending || diff !== 0 || debit === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
          <Icon name={pending ? "fa-spinner fa-spin" : "fa-check"} />{title ?? "Post voucher"}
        </button>
        <span className="text-xs text-slate-500">A posted voucher can never be edited — corrections are reversals.</span>
      </div>
    </form>
  );
}
