"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { postPurchaseAction, postSaleAction } from "@/app/actions/counter";
import { useFormAction } from "@/components/useFormAction";
import { Icon, Note, cn } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { formatINR, formatQty, formatRate } from "@/lib/money";

export type PartyOpt = { id: string; full_name: string; party_code: string; phone: string | null; is_client: boolean; is_depositor: boolean; receivable_inr: string; owed_fx: string; owed_inr: string };
export type DepositOpt = { deposit_id: string; voucher_no: string; depositor_name: string; manual_rate: string; fx_unallocated: string };
export type CashOpt = { code: string; name: string; currency_code: string };

type Props = {
  mode: "buy" | "sell";
  parties: PartyOpt[];
  currencies: string[];      // what the desk deals to clients in (not INR, not USD)
  buyCurrencies: string[];   // USD first, then the others
  deposits: DepositOpt[];    // oldest first, with USD left
  cash: CashOpt[];
  base: string; primary: string; today: string;
  canSell: boolean; canCreate: boolean;
};

const num = (v: string) => { const n = Number(v.replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };

/**
 * One screen for the counter. Buy | Sell at the top, five fields, the arithmetic as you
 * type, and the "settled now" boxes that post the follow-ups in the same tap. After a
 * save the form clears and the cursor is back on the party — the next entry starts at once.
 */
export function EntryForm(p: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<"buy" | "sell">(p.canSell ? p.mode : "buy");
  const [saleState, onSale, salePending] = useFormAction<ActionState>(postSaleAction, {});
  const [buyState, onBuy, buyPending] = useFormAction<ActionState>(postPurchaseAction, {});
  const state = tab === "sell" ? saleState : buyState;
  const pending = salePending || buyPending;

  // party
  const [q, setQ] = useState("");
  const [party, setParty] = useState<PartyOpt | null>(null);
  const [open, setOpen] = useState(false);
  const partyRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const candidates = useMemo(() => {
    const pool = p.parties.filter((x) => (tab === "sell" ? x.is_client : x.is_depositor));
    const s = q.trim().toLowerCase();
    if (!s) return pool.slice(0, 8);
    return pool.filter((x) => x.full_name.toLowerCase().includes(s) || x.party_code.toLowerCase().includes(s) || (x.phone ?? "").includes(s)).slice(0, 8);
  }, [p.parties, q, tab]);

  // figures
  const [currency, setCurrency] = useState(tab === "sell" ? (p.currencies[0] ?? "") : p.primary);
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [total, setTotal] = useState("");
  const [src, setSrc] = useState("");
  const [toPrimary, setToPrimary] = useState("");
  const [handOver, setHandOver] = useState(true);
  const [collect, setCollect] = useState(true);
  const [payNow, setPayNow] = useState(false);
  const [payRate, setPayRate] = useState("");
  const [more, setMore] = useState(false);

  const amt = num(amount), rt = num(rate);
  const billed = amt && rt ? Math.round(amt * rt * 100) / 100 : 0;

  // FIFO preview for a sale: which purchases the USD comes from, and what it costs
  const fifo = useMemo(() => {
    let left = num(src); const rows: Array<{ d: DepositOpt; take: number }> = []; let cost = 0;
    for (const d of p.deposits) {
      if (left <= 0) break;
      const take = Math.min(left, Number(d.fx_unallocated));
      if (take > 0) { rows.push({ d, take }); cost += take * Number(d.manual_rate); left -= take; }
    }
    return { rows, cost: Math.round(cost * 100) / 100, short: left > 0.00005 ? left : 0 };
  }, [p.deposits, src]);
  const margin = billed && fifo.cost ? Math.round((billed - fifo.cost) * 100) / 100 : 0;
  const totalUsd = p.deposits.reduce((a, d) => a + Number(d.fx_unallocated), 0);

  // rupee total ↔ rate, either way round
  const onRate = (v: string) => { setRate(v); const r = num(v); setTotal(amt && r ? (Math.round(amt * r * 100) / 100).toFixed(2) : ""); };
  const onTotal = (v: string) => { setTotal(v); const t = num(v); setRate(amt && t ? (Math.round((t / amt) * 1e6) / 1e6).toString() : ""); };
  const onAmount = (v: string) => { setAmount(v); const a = num(v); if (rt && a) setTotal((Math.round(a * rt * 100) / 100).toFixed(2)); };

  const switchTab = (t: "buy" | "sell") => {
    if (t === "sell" && !p.canSell) return;
    setTab(t); setParty(null); setQ(""); setAmount(""); setRate(""); setTotal(""); setSrc(""); setToPrimary(""); setPayRate("");
    setCurrency(t === "sell" ? (p.currencies[0] ?? "") : p.primary);
    setTimeout(() => partyRef.current?.focus(), 0);
  };

  // after a successful save: clear, keep the tab, refresh the strip, focus the party box
  const seen = useRef<ActionState>(state);
  useEffect(() => {
    if (state !== seen.current && state.ok) {
      setParty(null); setQ(""); setAmount(""); setRate(""); setTotal(""); setSrc(""); setToPrimary(""); setPayRate("");
      router.refresh();
      setTimeout(() => partyRef.current?.focus(), 0);
    }
    seen.current = state;
  }, [state, router]);

  useEffect(() => { partyRef.current?.focus(); }, []);

  const cashFor = (cur: string) => p.cash.filter((c) => c.currency_code.trim() === cur);
  const fieldCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200";
  const label = "block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1";
  const sell = tab === "sell";

  return (
    <form ref={formRef} onSubmit={sell ? onSale : onBuy} className="space-y-4"
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); switchTab(tab); } }}>
      {/* Buy | Sell */}
      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 text-center text-sm font-bold">
        <button type="button" onClick={() => switchTab("buy")} className={cn("py-3", !sell ? "bg-emerald-600 text-white" : "bg-white text-slate-500 hover:bg-emerald-50")}>
          <Icon name="fa-plus" className="mr-2" />Buy from a depositor
        </button>
        <button type="button" onClick={() => switchTab("sell")} disabled={!p.canSell} title={p.canSell ? "" : "Needs the deal permission"}
          className={cn("py-3", sell ? "bg-amber-600 text-white" : "bg-white text-slate-500 hover:bg-amber-50 disabled:opacity-40")}>
          <Icon name="fa-minus" className="mr-2" />Sell to a client
        </button>
      </div>

      {state.error && <Note tone="rose" icon="fa-circle-exclamation">{state.error}</Note>}
      {state.ok && state.message && <Note tone="emerald" icon="fa-circle-check">{state.message}</Note>}

      {/* party */}
      <div className="relative">
        <label className={label}>{sell ? "Client — type a name, code or mobile" : "Depositor — type a name, code or mobile"}</label>
        <input ref={partyRef} value={party ? party.full_name : q} autoComplete="off" placeholder={sell ? "Blue Ocean…" : "Mehta…"}
          onChange={(e) => { setParty(null); setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => { if (e.key === "Enter" && !party && candidates[0]) { e.preventDefault(); setParty(candidates[0]); setOpen(false); } }}
          className={cn(fieldCls, "pr-28")} />
        {party && (
          <span className="absolute right-2 top-7 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
            {party.party_code}{sell ? (Number(party.receivable_inr) ? ` · owes ${formatINR(party.receivable_inr, { decimals: 0 })}` : " · owes ₹0") : (Number(party.owed_fx) ? ` · owed ${formatQty(party.owed_fx)} ${p.primary}` : " · nothing owed")}
          </span>
        )}
        <input type="hidden" name={sell ? "clientId" : "depositorId"} value={party?.id ?? ""} />
        {open && !party && candidates.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
            {candidates.map((c) => (
              <li key={c.id}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setParty(c); setOpen(false); }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-sky-50">
                <span><b>{c.full_name}</b> <span className="text-slate-400">{c.party_code}{c.phone ? ` · ${c.phone}` : ""}</span></span>
                <span className="text-xs text-slate-500">{sell ? (Number(c.receivable_inr) ? `owes ${formatINR(c.receivable_inr, { decimals: 0 })}` : "") : (Number(c.owed_fx) ? `owed ${formatQty(c.owed_fx)} ${p.primary}` : "")}</span>
              </button></li>
            ))}
          </ul>
        )}
      </div>

      {/* currency · amount · rate · total */}
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <label className={label}>Currency</label>
          <select name={sell ? "fxCurrency" : "currency"} value={currency} onChange={(e) => setCurrency(e.target.value)} className={fieldCls}>
            {(sell ? p.currencies : p.buyCurrencies).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Amount</label>
          <input name="fxAmount" inputMode="decimal" value={amount} onChange={(e) => onAmount(e.target.value)} placeholder="2000" required className={cn(fieldCls, "text-right tabular-nums")} />
        </div>
        <div>
          <label className={label}>{sell ? `Rate — ₹ per 1 ${currency}` : (currency === p.primary ? `Rate — ₹ per 1 ${p.primary}` : `Rate — ₹ per 1 ${p.primary}`)}</label>
          <input name={sell ? "fxToInrRate" : "rate"} inputMode="decimal" value={rate} onChange={(e) => onRate(e.target.value)} placeholder="93.50" required className={cn(fieldCls, "text-right tabular-nums")} />
        </div>
        <div>
          <label className={label}>{sell ? "Client pays ₹" : "Worth ₹"}</label>
          <input inputMode="decimal" value={total} onChange={(e) => onTotal(e.target.value)} placeholder="1,87,000" disabled={!sell && currency !== p.primary}
            className={cn(fieldCls, "text-right tabular-nums", !sell && currency !== p.primary && "bg-slate-50 text-slate-400")} />
        </div>
      </div>
      {!sell && currency !== p.primary && (
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className={label}>1 {currency} in {p.primary} — the rate it is changed at</label>
            <input name="toPrimaryRate" inputMode="decimal" value={toPrimary} onChange={(e) => setToPrimary(e.target.value)} placeholder="1.08" required className={cn(fieldCls, "text-right tabular-nums")} />
          </div>
          <div className="sm:col-span-2 self-end text-xs text-slate-500">
            {amt && num(toPrimary) ? <>= <b>{formatQty(amt * num(toPrimary))} {p.primary}</b>, worth {formatINR(amt * num(toPrimary) * rt)} — the depositor is owed {p.primary}, not {currency}.</> : "The depositor hands over this currency; the desk books it as USD."}
          </div>
        </div>
      )}

      {/* sell: the USD it costs, and where it comes from */}
      {sell && (
        <div className="rounded-xl border border-dashed border-sky-200 bg-sky-50/60 p-3 text-sm">
          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <label className={label}>{p.primary} it costs us</label>
              <input name="srcAmount" inputMode="decimal" value={src} onChange={(e) => setSrc(e.target.value)} placeholder="2150" required className={cn(fieldCls, "text-right tabular-nums")} />
            </div>
            <div className="sm:col-span-3 self-end">
              {num(src) > 0 ? (
                fifo.short > 0
                  ? <span className="text-rose-700"><Icon name="fa-triangle-exclamation" className="mr-1" />Only <b>{formatQty(totalUsd)} {p.primary}</b> is unspent — short by {formatQty(fifo.short)}. Buy first.</span>
                  : <>Taken from the oldest purchase first — {fifo.rows.map((r) => `${formatQty(r.take)} from ${r.d.depositor_name} @ ${formatRate(r.d.manual_rate)}`).join(", ")} · cost <b>{formatINR(fifo.cost)}</b> ·{" "}
                      <b className={margin < 0 ? "text-rose-700" : "text-emerald-700"}>{margin < 0 ? "loss" : "margin"} {formatINR(Math.abs(margin))}</b>{margin < 0 && " — recorded, not blocked"}</>
              ) : <span className="text-slate-500">Type how many {p.primary} this sale uses; the purchases it comes from and the margin appear here. {formatQty(totalUsd)} {p.primary} unspent.</span>}
            </div>
          </div>
        </div>
      )}

      {/* settled now? */}
      <div className={cn("grid gap-3", sell ? "sm:grid-cols-2" : "sm:grid-cols-2")}>
        {sell ? (
          <>
            <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm", handOver ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white")}>
              <input type="checkbox" name="handOver" checked={handOver} onChange={(e) => setHandOver(e.target.checked)} className="mt-1 h-4 w-4 accent-emerald-600" />
              <span><b>Currency handed over now</b><br /><span className="text-xs text-slate-500">{amt ? `${formatQty(amt)} ${currency}` : currency} out of{" "}
                {cashFor(currency).length > 1 ? <select name="handOverAccount" className="rounded border border-slate-200 bg-white px-1 py-0.5 text-xs">{cashFor(currency).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select> : (cashFor(currency)[0]?.name ?? `Cash/Bank — ${currency}`)}</span></span>
            </label>
            <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm", collect ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white")}>
              <input type="checkbox" name="collect" checked={collect} onChange={(e) => setCollect(e.target.checked)} className="mt-1 h-4 w-4 accent-emerald-600" />
              <span><b>₹ received now</b><br /><span className="text-xs text-slate-500">{billed ? formatINR(billed) : "the billed amount"} into{" "}
                {cashFor(p.base).length > 1 ? <select name="collectAccount" className="rounded border border-slate-200 bg-white px-1 py-0.5 text-xs">{cashFor(p.base).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select> : (cashFor(p.base)[0]?.name ?? `Cash/Bank — ${p.base}`)}</span></span>
            </label>
          </>
        ) : (
          <>
            <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm", payNow ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white")}>
              <input type="checkbox" name="payNow" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} className="mt-1 h-4 w-4 accent-emerald-600" />
              <span><b>Paid the depositor now</b><br /><span className="text-xs text-slate-500">in rupees, at the rate agreed today — otherwise it waits on Home under &ldquo;Pay&rdquo;</span></span>
            </label>
            {payNow && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>Rate paid — ₹ per 1 {p.primary}</label>
                  <input name="payRate" inputMode="decimal" value={payRate} onChange={(e) => setPayRate(e.target.value)} placeholder={rate || "86.00"} required className={cn(fieldCls, "text-right tabular-nums")} />
                </div>
                <div className="self-end text-xs text-slate-600">
                  {amt && num(payRate) ? <>Rupees out <b>{formatINR((currency === p.primary ? amt : amt * num(toPrimary)) * num(payRate))}</b>{rt && num(payRate) !== rt && <><br />{num(payRate) < rt ? "the rate moved our way" : "the rate moved against us"} — {formatINR(Math.abs((currency === p.primary ? amt : amt * num(toPrimary)) * (rt - num(payRate))))} to {num(payRate) < rt ? "FX Margin" : "Exchange Loss"}</>}</> : "Type the rate to see the rupees out."}
                  {cashFor(p.base).length > 1 && <select name="payAccount" className="mt-1 block rounded border border-slate-200 bg-white px-1 py-0.5 text-xs">{cashFor(p.base).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select>}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* date · more details */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <label className="flex items-center gap-2">Date <input type="date" name="date" defaultValue={p.today} className="rounded border border-slate-200 px-2 py-1 text-xs" /></label>
        <button type="button" onClick={() => setMore((m) => !m)} className="text-sky-700 hover:underline">{more ? "fewer details" : "more details"} (reference no., why this rate, note)</button>
        <span className="ml-auto hidden sm:inline"><kbd className="rounded border px-1">Tab</kbd> next · <kbd className="rounded border px-1">Enter</kbd> saves · <kbd className="rounded border px-1">Esc</kbd> clears</span>
      </div>
      {more && (
        <div className="grid gap-3 sm:grid-cols-3">
          <input name="referenceNo" placeholder="Reference no. (SWIFT / NEFT / memo)" className={fieldCls} />
          <input name="rateJustification" placeholder="Why this rate — for the auditor" className={fieldCls} />
          <input name="narration" placeholder="Note" className={fieldCls} />
        </div>
      )}

      <button type="submit" disabled={pending || !party || (sell && fifo.short > 0)}
        className={cn("flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white disabled:opacity-50", sell ? "bg-amber-600 hover:bg-amber-700" : "bg-emerald-600 hover:bg-emerald-700")}>
        <Icon name={pending ? "fa-spinner fa-spin" : "fa-check"} />
        {sell
          ? (handOver || collect ? `Record the sale — ${[handOver && "hand-over", collect && "receipt"].filter(Boolean).join(" and ")} with it` : "Record the sale")
          : (payNow ? "Record the purchase — and pay the depositor" : "Record the purchase")}
      </button>
      {!p.canCreate && <p className="text-xs text-amber-700">Your account can book sales but not post the hand-over or the receipt — untick the boxes, or ask Genius ITens for the voucher permission.</p>}
    </form>
  );
}
