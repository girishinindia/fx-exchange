"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { postExpenseAction, postPurchaseAction, postSaleAction, postTransferAction } from "@/app/actions/counter";
import { useFormAction } from "@/components/useFormAction";
import { Icon, Note, cn } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { formatINR, formatQty, formatRate } from "@/lib/money";

export type PartyOpt = { id: string; full_name: string; party_code: string; phone: string | null; is_client: boolean; is_depositor: boolean; receivable_inr: string; owed_fx: string; owed_inr: string; walk_in?: boolean };
export type DepositOpt = { deposit_id: string; voucher_no: string; depositor_name: string; manual_rate: string; fx_unallocated: string; currency_code: string };
export type CashOpt = { code: string; name: string; currency_code: string };
export type ExpenseOpt = { code: string; name: string };

export type LineKind = "buy" | "sell" | "expense" | "transfer";

type Props = {
  mode: LineKind;
  parties: PartyOpt[];
  currencies: string[];      // every currency the desk deals in, the dealing currency first
  deposits: DepositOpt[];    // oldest first, with something left, any currency
  cash: CashOpt[];
  expenseHeads: ExpenseOpt[];
  base: string; primary: string; today: string;
  canSell: boolean; canCreate: boolean;
};

const num = (v: string) => { const n = Number(v.replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };

/**
 * The entry line of the day sheet. Buy | Sell | Expense | Cash⇄Bank, the party (or walk-in),
 * currency, units, the rate — orange and empty every time — and which rupee drawer moved.
 * Buy and Sell settle on the spot unless "later" is chosen. After a save the line clears and
 * the cursor is back on the party, and the grid underneath has the new row.
 */
export function EntryForm(p: Props) {
  const router = useRouter();
  const [kind, setKind] = useState<LineKind>(p.mode === "sell" && !p.canSell ? "buy" : p.mode);
  const [saleState, onSale, salePending] = useFormAction<ActionState>(postSaleAction, {});
  const [buyState, onBuy, buyPending] = useFormAction<ActionState>(postPurchaseAction, {});
  const [expState, onExpense, expPending] = useFormAction<ActionState>(postExpenseAction, {});
  const [trState, onTransfer, trPending] = useFormAction<ActionState>(postTransferAction, {});
  const state = kind === "sell" ? saleState : kind === "buy" ? buyState : kind === "expense" ? expState : trState;
  const pending = salePending || buyPending || expPending || trPending;
  const onSubmit = kind === "sell" ? onSale : kind === "buy" ? onBuy : kind === "expense" ? onExpense : onTransfer;

  // party
  const [q, setQ] = useState("");
  const [party, setParty] = useState<PartyOpt | null>(null);
  const [open, setOpen] = useState(false);
  const partyRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const sell = kind === "sell", buy = kind === "buy";
  const walkIn = p.parties.find((x) => x.walk_in) ?? null;
  const candidates = useMemo(() => {
    const pool = p.parties.filter((x) => (sell ? x.is_client : x.is_depositor));
    const s = q.trim().toLowerCase();
    const list = !s ? pool : pool.filter((x) => x.full_name.toLowerCase().includes(s) || x.party_code.toLowerCase().includes(s) || (x.phone ?? "").includes(s) || (x.walk_in && "walk-in walkin traveller".includes(s)));
    // the walk-in always sits first
    return [...list.filter((x) => x.walk_in), ...list.filter((x) => !x.walk_in)].slice(0, 8);
  }, [p.parties, q, sell]);

  // figures
  const rupeeAccounts = p.cash.filter((c) => c.currency_code.trim() === p.base);
  const [currency, setCurrency] = useState(p.primary);
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [total, setTotal] = useState("");
  const [src, setSrc] = useState("");
  const [fundFrom, setFundFrom] = useState<"own" | "primary" | null>(null);   // null = the rule
  const [keep, setKeep] = useState(true);
  const [toPrimary, setToPrimary] = useState("");
  const [handOver, setHandOver] = useState(true);
  const [settleNow, setSettleNow] = useState(true);   // ₹ received now (sell) / paid the depositor now (buy)
  const [payRate, setPayRate] = useState("");
  const [paidBy, setPaidBy] = useState(rupeeAccounts[0]?.code ?? `CASH-${p.base}`);
  const [expenseHead, setExpenseHead] = useState(p.expenseHeads[0]?.code ?? "");
  const [direction, setDirection] = useState<"toBank" | "toCash">("toBank");
  const [more, setMore] = useState(false);
  const [note, setNote] = useState("");

  const amt = num(amount), rt = num(rate);
  const billed = amt && rt ? Math.round(amt * rt * 100) / 100 : 0;

  // how a sale is funded: from that currency's own stock when there is any (or it is the dealing
  // currency), otherwise by spending the dealing currency — the same rule the server applies
  const ownStock = useMemo(() => p.deposits.filter((d) => d.currency_code === currency).reduce((a, d) => a + Number(d.fx_unallocated), 0), [p.deposits, currency]);
  const primaryStock = useMemo(() => p.deposits.filter((d) => d.currency_code === p.primary).reduce((a, d) => a + Number(d.fx_unallocated), 0), [p.deposits, p.primary]);
  const own = fundFrom ? fundFrom === "own" : (currency === p.primary || ownStock > 0);
  const srcCurrency = own ? currency : p.primary;
  const srcQty = own ? amt : num(src);

  // FIFO preview: which lots the sale takes, and what they cost
  const fifo = useMemo(() => {
    let left = srcQty; const rows: Array<{ d: DepositOpt; take: number }> = []; let cost = 0;
    for (const d of p.deposits.filter((d) => d.currency_code === srcCurrency)) {
      if (left <= 0) break;
      const take = Math.min(left, Number(d.fx_unallocated));
      if (take > 0) { rows.push({ d, take }); cost += take * Number(d.manual_rate); left -= take; }
    }
    return { rows, cost: Math.round(cost * 100) / 100, short: left > 0.00005 ? left : 0 };
  }, [p.deposits, srcCurrency, srcQty]);
  const margin = billed && fifo.cost ? Math.round((billed - fifo.cost) * 100) / 100 : 0;

  // rupee total ↔ rate, either way round
  const onRate = (v: string) => { setRate(v); const r = num(v); setTotal(amt && r ? (Math.round(amt * r * 100) / 100).toFixed(2) : ""); if (buy && settleNow) setPayRate(v); };
  const onTotal = (v: string) => { setTotal(v); const t = num(v); const r = amt && t ? (Math.round((t / amt) * 1e6) / 1e6).toString() : ""; setRate(r); if (buy && settleNow) setPayRate(r); };
  const onAmount = (v: string) => { setAmount(v); const a = num(v); if (rt && a) setTotal((Math.round(a * rt * 100) / 100).toFixed(2)); };

  const clear = () => {
    setParty(null); setQ(""); setAmount(""); setRate(""); setTotal(""); setSrc(""); setToPrimary(""); setPayRate(""); setNote(""); setFundFrom(null);
  };
  const switchKind = (k: LineKind) => {
    if (k === "sell" && !p.canSell) return;
    if ((k === "expense" || k === "transfer") && !p.canCreate) return;
    setKind(k); clear();
    setCurrency(p.primary); setHandOver(true); setSettleNow(true); setKeep(true);
    setTimeout(() => (k === "buy" || k === "sell" ? partyRef.current : amountRef.current)?.focus(), 0);
  };
  const pickParty = (c: PartyOpt) => {
    setParty(c); setOpen(false);
    if (c.walk_in) setSettleNow(true);       // a walk-in cannot owe
  };

  // after a successful save: clear, keep the line type, refresh the grid, focus the party box
  const seen = useRef<ActionState>(state);
  useEffect(() => {
    if (state !== seen.current && state.ok) {
      clear();
      router.refresh();
      setTimeout(() => (sell || buy ? partyRef.current : amountRef.current)?.focus(), 0);
    }
    seen.current = state;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, router]);

  useEffect(() => { partyRef.current?.focus(); }, []);

  const cashFor = (cur: string) => p.cash.filter((c) => c.currency_code.trim() === cur);
  const fieldCls = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200";
  const rateCls = "w-full rounded-lg border-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200 placeholder:text-amber-700/60";
  const label = "block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1";
  const tone = sell ? "amber" : buy ? "emerald" : kind === "expense" ? "violet" : "sky";
  const toneBg = { amber: "bg-amber-600 hover:bg-amber-700", emerald: "bg-emerald-600 hover:bg-emerald-700", violet: "bg-violet-600 hover:bg-violet-700", sky: "bg-sky-600 hover:bg-sky-700" }[tone];
  const paidByLabel = (code: string) => rupeeAccounts.find((c) => c.code === code)?.name.replace(/ — .*$/, "") ?? code;
  const otherRupee = (code: string) => rupeeAccounts.find((c) => c.code !== code)?.code ?? code;

  const paidByBlock = (name: string, hint: string) => (
    <div>
      <label className={label}>{hint}</label>
      <div className="flex overflow-hidden rounded-lg border border-slate-200 text-xs font-bold">
        {rupeeAccounts.map((c) => (
          <button key={c.code} type="button" onClick={() => setPaidBy(c.code)}
            className={cn("flex-1 px-2 py-2", paidBy === c.code ? "bg-emerald-600 text-white" : "bg-white text-slate-600 hover:bg-emerald-50")}>
            ₹ {paidByLabel(c.code)}
          </button>
        ))}
      </div>
      <input type="hidden" name={name} value={paidBy} />
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-3"
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); switchKind(kind); } }}>
      {/* the line type */}
      <div className="grid grid-cols-4 overflow-hidden rounded-xl border border-slate-200 text-center text-sm font-bold">
        {([
          ["buy", "Buy", "fa-plus", "we take currency, give ₹", "bg-emerald-600", true],
          ["sell", "Sell", "fa-minus", "we give currency, take ₹", "bg-amber-600", p.canSell],
          ["expense", "Expense", "fa-receipt", "₹ out, with a reason", "bg-violet-600", p.canCreate],
          ["transfer", "Cash⇄Bank", "fa-right-left", "₹ between drawer and bank", "bg-sky-600", p.canCreate],
        ] as const).map(([k, t, ic, sub, bg, ok]) => (
          <button key={k} type="button" onClick={() => switchKind(k)} disabled={!ok}
            className={cn("py-2.5 disabled:opacity-40", kind === k ? `${bg} text-white` : "bg-white text-slate-500 hover:bg-slate-50")}>
            <Icon name={ic} className="mr-1.5" />{t}
            <span className={cn("block text-[10px] font-normal", kind === k ? "text-white/80" : "text-slate-400")}>{sub}</span>
          </button>
        ))}
      </div>

      {state.error && <Note tone="rose" icon="fa-circle-exclamation">{state.error}</Note>}
      {state.ok && state.message && <Note tone="emerald" icon="fa-circle-check">{state.message}</Note>}

      {(sell || buy) && (
        <>
          {/* party · currency · units · rate · total */}
          <div className="grid gap-3 lg:grid-cols-[1.6fr_.8fr_.9fr_1fr_1fr]">
            <div className="relative">
              <label className={label}>{sell ? "Client — name, code, mobile, or walk-in" : "Depositor — name, code, mobile, or walk-in"}</label>
              <input ref={partyRef} value={party ? party.full_name : q} autoComplete="off" placeholder={sell ? "Bhumika… or walk-in" : "Aarti… or walk-in"}
                onChange={(e) => { setParty(null); setQ(e.target.value); setOpen(true); }}
                onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)}
                onKeyDown={(e) => { if (e.key === "Enter" && !party && candidates[0]) { e.preventDefault(); pickParty(candidates[0]); setTimeout(() => amountRef.current?.focus(), 0); } }}
                className={cn(fieldCls, "pr-24")} />
              {party && (
                <span className="absolute right-2 top-7 max-w-[45%] truncate rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                  {party.walk_in ? "no account · pays now" : `${party.party_code}${sell ? (Number(party.receivable_inr) ? ` · owes ${formatINR(party.receivable_inr, { decimals: 0 })}` : "") : (Number(party.owed_fx) ? ` · owed ${formatQty(party.owed_fx)}` : "")}`}
                </span>
              )}
              <input type="hidden" name={sell ? "clientId" : "depositorId"} value={party?.id ?? ""} />
              {open && !party && candidates.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                  {candidates.map((c) => (
                    <li key={c.id}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pickParty(c)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-sky-50">
                      <span>{c.walk_in ? <><Icon name="fa-person-walking" className="mr-1 text-sky-600" /><b>Walk-in</b> <span className="text-slate-400">no account · settles on the spot</span></> : <><b>{c.full_name}</b> <span className="text-slate-400">{c.party_code}{c.phone ? ` · ${c.phone}` : ""}</span></>}</span>
                      <span className="text-xs text-slate-500">{c.walk_in ? "" : sell ? (Number(c.receivable_inr) ? `owes ${formatINR(c.receivable_inr, { decimals: 0 })}` : "") : (Number(c.owed_fx) ? `owed ${formatQty(c.owed_fx)}` : "")}</span>
                    </button></li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <label className={label}>Currency</label>
              <select name={sell ? "fxCurrency" : "currency"} value={currency} onChange={(e) => { setCurrency(e.target.value); setFundFrom(null); }} className={fieldCls}>
                {p.currencies.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Units</label>
              <input ref={amountRef} name="fxAmount" inputMode="decimal" value={amount} onChange={(e) => onAmount(e.target.value)} placeholder="100" required className={cn(fieldCls, "text-right tabular-nums")} />
            </div>
            <div>
              <label className={cn(label, "text-amber-700")}>₹ per 1 {buy && !keep && currency !== p.primary ? p.primary : currency}</label>
              <input name={sell ? "fxToInrRate" : "rate"} inputMode="decimal" value={rate} onChange={(e) => onRate(e.target.value)} placeholder="type today's rate" required className={cn(rateCls, "text-right tabular-nums")} />
            </div>
            <div>
              <label className={label}>{sell ? "Client pays ₹" : "Worth ₹"}</label>
              <input inputMode="decimal" value={total} onChange={(e) => onTotal(e.target.value)} placeholder="—" disabled={buy && !keep && currency !== p.primary}
                className={cn(fieldCls, "text-right tabular-nums", buy && !keep && currency !== p.primary && "bg-slate-50 text-slate-400")} />
            </div>
          </div>

          {/* buy: keep it, or change it into the dealing currency */}
          {buy && currency !== p.primary && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs">
              <label className="flex items-center gap-2"><input type="radio" name="keepChoice" checked={keep} onChange={() => setKeep(true)} className="accent-emerald-600" /><b>Keep the {currency}</b> — it goes into the {currency} drawer; the depositor is owed {currency}</label>
              <label className="flex items-center gap-2"><input type="radio" name="keepChoice" checked={!keep} onChange={() => setKeep(false)} className="accent-emerald-600" />Change it into {p.primary} at</label>
              {!keep && <input name="toPrimaryRate" inputMode="decimal" value={toPrimary} onChange={(e) => setToPrimary(e.target.value)} placeholder={`1 ${currency} = ? ${p.primary}`} required className={cn(fieldCls, "w-40 text-right tabular-nums")} />}
              {!keep && amt && num(toPrimary) ? <span className="text-slate-600">= <b>{formatQty(amt * num(toPrimary))} {p.primary}</b>{rt ? `, worth ${formatINR(amt * num(toPrimary) * rt)}` : ""}</span> : null}
              <input type="hidden" name="keep" value={keep ? "on" : ""} />
            </div>
          )}

          {/* sell: where the currency comes from, and the margin */}
          {sell && (
            <div className="rounded-xl border border-dashed border-sky-200 bg-sky-50/60 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex overflow-hidden rounded-lg border border-sky-200 text-xs font-bold">
                  <button type="button" onClick={() => setFundFrom("own")} disabled={currency !== p.primary && ownStock <= 0}
                    className={cn("px-3 py-1.5 disabled:opacity-40", own ? "bg-sky-600 text-white" : "bg-white text-slate-600")}>from {currency} stock{currency !== p.primary ? ` (${formatQty(ownStock)})` : ""}</button>
                  {currency !== p.primary && (
                    <button type="button" onClick={() => setFundFrom("primary")} className={cn("px-3 py-1.5", !own ? "bg-sky-600 text-white" : "bg-white text-slate-600")}>buy it with {p.primary}</button>
                  )}
                </div>
                <input type="hidden" name="srcCurrency" value={srcCurrency} />
                {!own && (
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{p.primary} it costs us</label>
                    <input name="srcAmount" inputMode="decimal" value={src} onChange={(e) => setSrc(e.target.value)} placeholder="28.28" required className={cn(fieldCls, "w-32 text-right tabular-nums")} />
                  </div>
                )}
                <div className="min-w-0 flex-1 text-xs text-slate-600">
                  {srcQty > 0 ? (
                    fifo.short > 0
                      ? <span className="text-rose-700"><Icon name="fa-triangle-exclamation" className="mr-1" />Only <b>{formatQty(own ? ownStock : primaryStock)} {srcCurrency}</b> in stock — short by {formatQty(fifo.short)}. Buy first.</span>
                      : <>Oldest lot first — {fifo.rows.map((r) => `${formatQty(r.take)} from ${r.d.depositor_name} @ ${formatRate(r.d.manual_rate)}`).join(", ")} · cost <b>{formatINR(fifo.cost)}</b>
                          {billed ? <> · <b className={margin < 0 ? "text-rose-700" : "text-emerald-700"}>{margin < 0 ? "loss" : "margin"} {formatINR(Math.abs(margin))}</b>{margin < 0 && " — recorded, not blocked"}</> : " · type the rate to see the margin"}</>
                  ) : <span className="text-slate-500">{own ? `Sold from the ${currency} drawer, oldest lot first — the margin appears once units and rate are typed.` : `Type how many ${p.primary} this sale uses. ${formatQty(primaryStock)} ${p.primary} unspent.`}</span>}
                </div>
              </div>
            </div>
          )}

          {/* settled now · paid by · handed over */}
          <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1.2fr]">
            {paidByBlock("paidBy", sell ? "₹ comes into" : "₹ goes out of")}
            <div>
              <label className={label}>{sell ? "₹ received" : "Depositor paid"}</label>
              <div className="flex overflow-hidden rounded-lg border border-slate-200 text-xs font-bold">
                <button type="button" onClick={() => setSettleNow(true)} className={cn("flex-1 px-2 py-2", settleNow ? "bg-emerald-600 text-white" : "bg-white text-slate-600 hover:bg-emerald-50")}>now</button>
                <button type="button" onClick={() => setSettleNow(false)} disabled={!!party?.walk_in} title={party?.walk_in ? "A walk-in always pays now" : ""}
                  className={cn("flex-1 px-2 py-2 disabled:opacity-40", !settleNow ? "bg-slate-700 text-white" : "bg-white text-slate-600 hover:bg-slate-50")}>later — on Home&rsquo;s to-do</button>
              </div>
              <input type="hidden" name={sell ? "collect" : "payNow"} value={settleNow ? "on" : ""} />
            </div>
            {sell ? (
              <label className={cn("flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-xs", handOver ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white")}>
                <input type="checkbox" name="handOver" checked={handOver} onChange={(e) => setHandOver(e.target.checked)} className="mt-0.5 h-4 w-4 accent-emerald-600" />
                <span><b>{currency} handed over now</b><br /><span className="text-slate-500">{amt ? `${formatQty(amt)} ${currency}` : currency} out of{" "}
                  {cashFor(currency).length > 1 ? <select name="handOverAccount" className="rounded border border-slate-200 bg-white px-1 py-0.5 text-xs">{cashFor(currency).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select> : (cashFor(currency)[0]?.name ?? `Cash/Bank — ${currency}`)}{!handOver && " — waits on Home under Hand over"}</span></span>
              </label>
            ) : (
              <div className={cn(!settleNow && "opacity-50")}>
                <label className={cn(label, "text-amber-700")}>Rate paid — ₹ per 1 {keep || currency === p.primary ? currency : p.primary}</label>
                <div className="flex items-center gap-2">
                  <input name="payRate" inputMode="decimal" value={payRate} onChange={(e) => setPayRate(e.target.value)} disabled={!settleNow} placeholder="same as the line" required={settleNow} className={cn(rateCls, "text-right tabular-nums")} />
                  <span className="whitespace-nowrap text-xs text-slate-600">{settleNow && amt && num(payRate) ? <>out <b>{formatINR((keep || currency === p.primary ? amt : amt * num(toPrimary)) * num(payRate))}</b></> : settleNow ? "rupees out" : "not paid today"}</span>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {kind === "expense" && (
        <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr_1fr_1.6fr]">
          <div>
            <label className={label}>What for</label>
            <select name="accountCode" value={expenseHead} onChange={(e) => setExpenseHead(e.target.value)} className={fieldCls}>
              {p.expenseHeads.map((h) => <option key={h.code} value={h.code}>{h.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Amount ₹</label>
            <input ref={amountRef} name="inrAmount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50" required className={cn(fieldCls, "text-right tabular-nums")} />
          </div>
          {paidByBlock("paidFrom", "Paid from")}
          <div>
            <label className={label}>Remark</label>
            <input name="narration" value={note} onChange={(e) => setNote(e.target.value)} placeholder="staff tea · October rent" className={fieldCls} />
          </div>
        </div>
      )}

      {kind === "transfer" && rupeeAccounts.length >= 2 && (
        <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr_1.6fr]">
          <div>
            <label className={label}>Direction</label>
            <div className="flex overflow-hidden rounded-lg border border-slate-200 text-xs font-bold">
              <button type="button" onClick={() => setDirection("toBank")} className={cn("flex-1 px-2 py-2", direction === "toBank" ? "bg-sky-600 text-white" : "bg-white text-slate-600")}>{paidByLabel(rupeeAccounts[0].code)} → {paidByLabel(otherRupee(rupeeAccounts[0].code))}</button>
              <button type="button" onClick={() => setDirection("toCash")} className={cn("flex-1 px-2 py-2", direction === "toCash" ? "bg-sky-600 text-white" : "bg-white text-slate-600")}>{paidByLabel(otherRupee(rupeeAccounts[0].code))} → {paidByLabel(rupeeAccounts[0].code)}</button>
            </div>
            <input type="hidden" name="from" value={direction === "toBank" ? rupeeAccounts[0].code : otherRupee(rupeeAccounts[0].code)} />
            <input type="hidden" name="to" value={direction === "toBank" ? otherRupee(rupeeAccounts[0].code) : rupeeAccounts[0].code} />
          </div>
          <div>
            <label className={label}>Amount ₹</label>
            <input ref={amountRef} name="inrAmount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2000" required className={cn(fieldCls, "text-right tabular-nums")} />
          </div>
          <div>
            <label className={label}>Remark</label>
            <input name="narration" value={note} onChange={(e) => setNote(e.target.value)} placeholder="drawer to bank" className={fieldCls} />
          </div>
        </div>
      )}
      {kind === "transfer" && rupeeAccounts.length < 2 && <Note tone="amber">This company has one rupee account. Add a bank account under Ledger → Chart of accounts to move money between them.</Note>}

      {/* date · remark · more · save */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-500">Date<br /><input type="date" name="date" defaultValue={p.today} className="rounded-lg border border-slate-200 px-2 py-2 text-sm" /></label>
        {(sell || buy) && (
          <div className="min-w-[12rem] flex-1">
            <label className={label}>Remark (optional)</label>
            <input name="narration" value={note} onChange={(e) => setNote(e.target.value)} placeholder={sell ? "tourist visa · Dubai trip" : "brought from Dubai"} className={fieldCls} />
          </div>
        )}
        <button type="submit" disabled={pending || ((sell || buy) && (!party || (sell && fifo.short > 0)))}
          className={cn("flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50", toneBg)}>
          <Icon name={pending ? "fa-spinner fa-spin" : "fa-check"} />
          {sell ? "Add the sale" : buy ? "Add the purchase" : kind === "expense" ? "Add the expense" : "Move the rupees"} <kbd className="rounded border border-white/40 px-1 text-[10px] font-normal">↵</kbd>
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <button type="button" onClick={() => setMore((m) => !m)} className="text-sky-700 hover:underline">{more ? "fewer details" : "more details"} (reference no., why this rate)</button>
        <span className="ml-auto hidden sm:inline"><kbd className="rounded border px-1">Tab</kbd> next · <kbd className="rounded border px-1">Enter</kbd> saves · <kbd className="rounded border px-1">Esc</kbd> clears · no rate is ever remembered</span>
      </div>
      {more && (
        <div className="grid gap-3 sm:grid-cols-2">
          <input name="referenceNo" placeholder="Reference no. (SWIFT / NEFT / memo)" className={fieldCls} />
          {(sell || buy) && <input name="rateJustification" placeholder="Why this rate — for the auditor" className={fieldCls} />}
        </div>
      )}
      {!p.canCreate && (sell || buy) && <p className="text-xs text-amber-700">Your account can book sales but not post the hand-over or the receipt — choose &ldquo;later&rdquo; and untick the hand-over, or ask Genius ITens for the voucher permission.</p>}
      {walkIn === null && (sell || buy) && <p className="text-xs text-slate-400">No walk-in party yet — it is created the first time somebody with the deal or voucher permission opens this page.</p>}
    </form>
  );
}
