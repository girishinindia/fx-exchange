"use client";

import { useMemo, useState } from "react";
import { postDealAction } from "@/app/actions/deals";
import { useFormAction } from "@/components/useFormAction";
import { Field, Icon, Note, SelectField } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { formatINR, formatQty , formatRate } from "@/lib/money";

export type ClientOpt = { id: string; full_name: string; party_code: string; receivable_inr: string };
export type DepositOpt = {
  deposit_id: string; voucher_no: string; deposit_date: string;
  depositor_name: string; manual_rate: string; fx_unallocated: string;
};

const n = (v: string) => (v && !Number.isNaN(Number(v)) ? Number(v) : 0);
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * The deal. Two rates, never one: what the client pays per unit of their currency, and what
 * the primary currency actually cost when depositors brought it in. The gap between them is
 * the margin, and it is on screen before anything is posted.
 */
export function DealForm({
  clients, deposits, currencies, primaryCurrency, baseCurrency, today,
}: {
  clients: ClientOpt[];
  deposits: DepositOpt[];
  currencies: string[];
  primaryCurrency: string;
  baseCurrency: string;
  today: string;
}) {
  const [state, onSubmit, pending] = useFormAction<ActionState>(postDealAction, {});
  const [clientId, setClientId] = useState("");
  const [fxCurrency, setFxCurrency] = useState(currencies[0] ?? "");
  const [fxAmount, setFxAmount] = useState("");
  const [billRate, setBillRate] = useState("");
  const [srcAmount, setSrcAmount] = useState("");
  const [auto, setAuto] = useState(true);
  const [slices, setSlices] = useState<Record<string, string>>({});

  const available = useMemo(() => deposits.reduce((a, d) => a + Number(d.fx_unallocated), 0), [deposits]);
  const src = n(srcAmount);
  const billed = r2(n(fxAmount) * n(billRate));

  // what the deal will take from each deposit: oldest first when automatic, otherwise as typed
  const plan = useMemo(() => {
    if (!auto) {
      return deposits
        .map((d) => ({ d, take: n(slices[d.deposit_id] ?? "") }))
        .filter((x) => x.take > 0);
    }
    let left = src;
    const out: { d: DepositOpt; take: number }[] = [];
    for (const d of deposits) {
      if (left <= 0) break;
      const take = r4(Math.min(Number(d.fx_unallocated), left));
      if (take > 0) out.push({ d, take });
      left = r4(left - take);
    }
    return out;
  }, [auto, deposits, slices, src]);

  const allocated = r4(plan.reduce((a, x) => a + x.take, 0));
  const cost = r2(plan.reduce((a, x) => a + x.take * Number(x.d.manual_rate), 0));
  const margin = r2(billed - cost);
  const marginPct = cost > 0 ? (margin * 100) / cost : 0;
  const over = plan.find((x) => x.take > Number(x.d.fx_unallocated) + 0.00005);
  const mismatch = src > 0 && Math.abs(allocated - src) > 0.00005;
  const ready = !!clientId && billed > 0 && src > 0 && !mismatch && !over;

  const autoFill = () => {
    let left = src;
    const next: Record<string, string> = {};
    for (const d of deposits) {
      if (left <= 0) break;
      const take = r4(Math.min(Number(d.fx_unallocated), left));
      if (take > 0) next[d.deposit_id] = String(take);
      left = r4(left - take);
    }
    setSlices(next);
  };

  const cell = "w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-sky-200";

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {(state.error || state.fieldErrors) && (
        <Note tone="rose" icon="fa-circle-exclamation">
          <span className="whitespace-pre-line">{state.error ?? Object.values(state.fieldErrors ?? {}).join("\n")}</span>
        </Note>
      )}

      <div className="grid md:grid-cols-3 gap-3">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Client <span className="text-rose-500">*</span></span>
          <select name="clientId" required value={clientId} onChange={(e) => setClientId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200">
            <option value="">Choose the client…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.full_name} ({c.party_code})</option>)}
          </select>
        </label>
        <Field label="Date" name="date" type="date" required defaultValue={today} />
        <Field label="Reference no." name="referenceNo" placeholder="SWIFT / contract note" />
      </div>

      {/* ---------------------------------------------------------------- what the client gets */}
      <section className="rounded-xl border border-sky-100 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-700"><Icon name="fa-arrow-right-from-bracket" className="mr-2 text-sky-500" />What the client gets, and what they pay</h3>
        <div className="mt-3 grid md:grid-cols-4 gap-3 items-start">
          <SelectField label="Currency" name="fxCurrency" value={fxCurrency} onChange={(e) => setFxCurrency(e.target.value)}
            options={currencies.map((c) => ({ value: c, label: c }))} />
          <Field label="Amount" name="fxAmount" required inputMode="decimal" placeholder="9200.00"
            value={fxAmount} onChange={(e) => setFxAmount(e.target.value)} />
          <Field label={`Rate — 1 ${fxCurrency || "unit"} in ${baseCurrency}`} name="fxToInrRate" required inputMode="decimal" placeholder="95.00"
            value={billRate} onChange={(e) => setBillRate(e.target.value)} hint="Agreed with this client, for this deal" />
          <div className="rounded-lg border border-sky-100 bg-sky-50/70 px-3 py-2">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Client is billed</div>
            <div className="mt-0.5 text-xl font-semibold tabular-nums text-sky-800">{formatINR(billed)}</div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- what it costs us */}
      <section className="rounded-xl border border-sky-100 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-700">
            <Icon name="fa-arrow-right-to-bracket" className="mr-2 text-sky-500" />What it costs us
          </h3>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" name="auto" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="rounded border-slate-300" />
            Take from the oldest deposits first
          </label>
        </div>

        <div className="mt-3 grid md:grid-cols-3 gap-3">
          <Field label={`${primaryCurrency} this deal spends`} name="srcAmount" required inputMode="decimal" placeholder="10000.00"
            value={srcAmount} onChange={(e) => setSrcAmount(e.target.value)}
            hint={`${formatQty(available)} ${primaryCurrency} unspent across ${deposits.length} deposit${deposits.length === 1 ? "" : "s"}`} />
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">It cost us</div>
            <div className="mt-0.5 text-xl font-semibold tabular-nums text-slate-800">{formatINR(cost)}</div>
            <div className="text-xs text-slate-500">{allocated > 0 ? `average ${formatRate(cost / allocated)} per ${primaryCurrency}` : "allocate to see the rate"}</div>
          </div>
          <div className={`rounded-lg border px-3 py-2 ${margin < 0 ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}`}>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{margin < 0 ? "Loss on this deal" : "Margin on this deal"}</div>
            <div className={`mt-0.5 text-xl font-semibold tabular-nums ${margin < 0 ? "text-rose-700" : "text-emerald-700"}`}>{formatINR(Math.abs(margin))}</div>
            <div className="text-xs text-slate-500">{cost > 0 ? `${marginPct.toFixed(2)}% of cost` : "billing − cost"}</div>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-sky-100">
          <table className="w-full text-sm">
            <thead className="bg-sky-50/70 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Deposit</th>
                <th className="px-3 py-2 text-left font-semibold">Depositor</th>
                <th className="px-3 py-2 text-right font-semibold">Its rate</th>
                <th className="px-3 py-2 text-right font-semibold">Unspent</th>
                <th className="px-3 py-2 text-right font-semibold">Taken</th>
                <th className="px-3 py-2 text-right font-semibold">Cost (₹)</th>
              </tr>
            </thead>
            <tbody>
              {deposits.map((d) => {
                const take = auto ? (plan.find((x) => x.d.deposit_id === d.deposit_id)?.take ?? 0) : n(slices[d.deposit_id] ?? "");
                const tooMuch = take > Number(d.fx_unallocated) + 0.00005;
                return (
                  <tr key={d.deposit_id} className={`border-t border-sky-50 ${take > 0 ? "bg-sky-50/40" : ""}`}>
                    <td className="px-3 py-1.5">{d.voucher_no}<span className="ml-2 text-xs text-slate-400">{d.deposit_date}</span></td>
                    <td className="px-3 py-1.5 text-slate-600">{d.depositor_name}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{formatRate(d.manual_rate)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatQty(d.fx_unallocated)}</td>
                    <td className="px-3 py-1.5 text-right w-36">
                      {auto ? (
                        <>
                          <span className="tabular-nums">{take ? formatQty(take) : "—"}</span>
                          <input type="hidden" name={`fund-${d.deposit_id}`} value={take ? String(take) : ""} />
                        </>
                      ) : (
                        <input name={`fund-${d.deposit_id}`} value={slices[d.deposit_id] ?? ""} inputMode="decimal" placeholder="0"
                          onChange={(e) => setSlices((s) => ({ ...s, [d.deposit_id]: e.target.value }))}
                          className={`${cell} ${tooMuch ? "border-rose-300 bg-rose-50" : ""}`} />
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{take ? formatINR(r2(take * Number(d.manual_rate))) : "—"}</td>
                  </tr>
                );
              })}
              {deposits.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                  No deposit has any {primaryCurrency} left. Record a deposit before booking a deal.
                </td></tr>
              )}
            </tbody>
            <tfoot className="border-t border-sky-100 bg-sky-50/70 text-sm font-semibold">
              <tr>
                <td colSpan={4} className="px-3 py-2 text-right text-slate-600">Allocated</td>
                <td className={`px-3 py-2 text-right tabular-nums ${mismatch ? "text-rose-700" : "text-emerald-700"}`}>{formatQty(allocated)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatINR(cost)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {!auto && (
          <button type="button" onClick={autoFill} className="mt-3 rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-50">
            <Icon name="fa-wand-magic-sparkles" className="mr-1" />Fill from the oldest deposits
          </button>
        )}
      </section>

      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Rate justification" name="rateJustification" placeholder="Why these rates — for the auditor" />
        <Field label="Narration" name="narration" placeholder="Anything worth remembering about this deal" />
      </div>

      {mismatch && (
        <Note tone="amber" icon="fa-triangle-exclamation">
          This deal spends {formatQty(src)} {primaryCurrency} but {formatQty(allocated)} is allocated.
          {allocated < src ? ` ${formatQty(r4(src - allocated))} more to allocate.` : ` Reduce the allocation by ${formatQty(r4(allocated - src))}.`}
        </Note>
      )}
      {over && <Note tone="rose" icon="fa-circle-exclamation">Deposit {over.d.voucher_no} has only {formatQty(over.d.fx_unallocated)} {primaryCurrency} left.</Note>}
      {margin < 0 && ready && (
        <Note tone="amber" icon="fa-arrow-trend-down">
          This deal sells below cost — {formatINR(Math.abs(margin))} will be posted as an exchange loss. It is recorded, not blocked.
        </Note>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || !ready}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
          <Icon name={pending ? "fa-spinner fa-spin" : "fa-right-left"} />Book the deal
        </button>
        <span className="text-xs text-slate-500">
          One voucher: the client is billed, the currency is bought, each deposit gives up its share at its own rate.
        </span>
      </div>
    </form>
  );
}
