"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { decimalStr, fieldErrors, optText, runAction, type ActionState } from "@/lib/action";
import { formatINR, formatQty } from "@/lib/money";
import { requireSession } from "@/lib/session";
import { postPurchase, postSale } from "@/server/services/counter";
import { postExpense, postTransfer } from "@/server/services/day";

const Sale = z.object({
  clientId: z.coerce.number().int().positive("Choose the client"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date"),
  fxCurrency: z.string().trim().regex(/^[A-Za-z]{3}$/, "Choose the currency").transform((v) => v.toUpperCase()),
  fxAmount: decimalStr("Amount", 4),
  fxToInrRate: decimalStr("Rate", 6),
  /** the currency it is funded from; the server's rule applies when blank */
  srcCurrency: z.string().trim().optional(),
  srcAmount: z.string().trim().optional(),
  referenceNo: optText(60),
  narration: optText(300),
  rateJustification: optText(300),
  clientRef: optText(80),
});

const Purchase = z.object({
  depositorId: z.coerce.number().int().positive("Choose the depositor"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date"),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "Choose the currency").transform((v) => v.toUpperCase()),
  fxAmount: decimalStr("Amount", 4),
  toPrimaryRate: z.string().trim().optional(),
  rate: decimalStr("Rate", 6),
  payRate: z.string().trim().optional(),
  referenceNo: optText(60),
  narration: optText(300),
  rateJustification: optText(300),
  clientRef: optText(80),
});

const Expense = z.object({
  accountCode: z.string().trim().min(1, "Choose what the expense was for"),
  inrAmount: decimalStr("Amount", 2),
  paidFrom: z.string().trim().min(1, "Choose the drawer it was paid from"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date"),
  narration: optText(300),
  referenceNo: optText(60),
  clientRef: optText(80),
});

const Transfer = z.object({
  from: z.string().trim().min(1, "Choose where the rupees come from"),
  to: z.string().trim().min(1, "Choose where the rupees go"),
  inrAmount: decimalStr("Amount", 2),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date"),
  narration: optText(300),
  referenceNo: optText(60),
  clientRef: optText(80),
});

const refresh = () => { for (const p of ["/entry", "/home", "/money", "/dashboard", "/deals", "/deposits", "/payouts", "/receipts", "/settlements", "/vouchers", "/reports/day-close"]) revalidatePath(p); };
const on = (fd: FormData, k: string) => fd.get(k) === "on";
const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" && v.trim() ? v.trim() : null; };
const rateRe = /^\d{1,9}(\.\d{1,6})?$/;

/** The counter's Sell: a deal, and — ticked — the hand-over and the receipt with it, all or nothing. */
export async function postSaleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const s = await requireSession();
    const v = Sale.safeParse(Object.fromEntries(fd));
    if (!v.success) return { fieldErrors: fieldErrors(v.error), error: v.error.issues[0]?.message };
    const d = v.data;
    const srcCurrency = d.srcCurrency ? d.srcCurrency.toUpperCase() : null;
    const ownStock = !srcCurrency || srcCurrency === d.fxCurrency;
    if (!ownStock && !/^\d{1,12}(\.\d{1,4})?$/.test(d.srcAmount ?? "")) return { error: `Type how much ${srcCurrency} this sale uses.`, fieldErrors: { srcAmount: "Amount needed" } };
    const posted = await postSale(s, {
      deal: { clientId: d.clientId, date: d.date, fxCurrency: d.fxCurrency, fxAmount: d.fxAmount, fxToInrRate: d.fxToInrRate,
        srcCurrency, srcAmount: ownStock ? null : d.srcAmount,
        referenceNo: d.referenceNo, narration: d.narration, rateJustification: d.rateJustification, clientRef: d.clientRef },
      handOver: on(fd, "handOver") ? { accountCode: str(fd, "handOverAccount") } : null,
      collect: on(fd, "collect") ? { accountCode: str(fd, "paidBy") ?? str(fd, "collectAccount") } : null,
    });
    refresh();
    const bits = [`Sold ${formatQty(posted.deal.fxAmount)} ${d.fxCurrency} — ${posted.deal.voucherNo}, ${Number(posted.deal.marginInr) < 0 ? "loss" : "margin"} ${formatINR(Math.abs(Number(posted.deal.marginInr)))}`];
    if (posted.deal.srcCurrency && posted.deal.srcCurrency !== d.fxCurrency) bits.push(`used ${formatQty(posted.deal.srcAmount)} ${posted.deal.srcCurrency}`);
    if (posted.payout) bits.push(`handed over (${posted.payout.voucherNo})`);
    if (posted.receipt) bits.push(`${formatINR(posted.receipt.inrAmount)} received (${posted.receipt.voucherNo})`);
    return { ok: true, message: bits.join(" · "), data: { dealId: posted.deal.id, voucherNo: posted.deal.voucherNo } };
  });
}

/** The counter's Buy: a deposit — kept as itself or changed into the dealing currency — and, ticked, the settlement with it. */
export async function postPurchaseAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const s = await requireSession();
    const v = Purchase.safeParse(Object.fromEntries(fd));
    if (!v.success) return { fieldErrors: fieldErrors(v.error), error: v.error.issues[0]?.message };
    const d = v.data;
    const payNow = on(fd, "payNow");
    const keep = on(fd, "keep");
    if (payNow && !rateRe.test(d.payRate ?? "")) return { error: "Type the rate you are paying the depositor at today.", fieldErrors: { payRate: "Rate needed" } };
    const posted = await postPurchase(s, {
      deposit: { depositorId: d.depositorId, date: d.date, currency: d.currency, fxAmount: d.fxAmount, keep,
        toPrimaryRate: !keep && d.toPrimaryRate ? d.toPrimaryRate : null, rate: d.rate,
        referenceNo: d.referenceNo, narration: d.narration, rateJustification: d.rateJustification, clientRef: d.clientRef },
      payNow: payNow ? { rate: d.payRate!, accountCode: str(fd, "paidBy") ?? str(fd, "payAccount") } : null,
    });
    refresh();
    const bits = [`Bought ${formatQty(posted.deposit.fxAmount)} ${posted.deposit.currency || d.currency} — ${posted.deposit.voucherNo}, worth ${formatINR(posted.deposit.inrAmount)}`];
    if (posted.settlement) bits.push(`paid ${formatINR(posted.settlement.inrAmount)} (${posted.settlement.voucherNo})`);
    else bits.push("waits on Home under Pay");
    return { ok: true, message: bits.join(" · "), data: { depositId: posted.deposit.id, voucherNo: posted.deposit.voucherNo } };
  });
}

/** An expense line on the day sheet: rupees out of the drawer or the bank, with a reason. */
export async function postExpenseAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const s = await requireSession();
    const v = Expense.safeParse(Object.fromEntries(fd));
    if (!v.success) return { fieldErrors: fieldErrors(v.error), error: v.error.issues[0]?.message };
    const d = v.data;
    const posted = await postExpense(s, { accountCode: d.accountCode, inrAmount: d.inrAmount, paidFrom: d.paidFrom, date: d.date, narration: d.narration, referenceNo: d.referenceNo, clientRef: d.clientRef });
    refresh();
    return { ok: true, message: `Expense ${formatINR(d.inrAmount)} — ${posted.voucherNo}`, data: { voucherNo: posted.voucherNo } };
  });
}

/** Rupees moved between the drawer and the bank. */
export async function postTransferAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const s = await requireSession();
    const v = Transfer.safeParse(Object.fromEntries(fd));
    if (!v.success) return { fieldErrors: fieldErrors(v.error), error: v.error.issues[0]?.message };
    const d = v.data;
    if (d.from.toUpperCase() === d.to.toUpperCase()) return { error: "From and to are the same account." };
    const posted = await postTransfer(s, { from: d.from, to: d.to, inrAmount: d.inrAmount, date: d.date, narration: d.narration, referenceNo: d.referenceNo, clientRef: d.clientRef });
    refresh();
    return { ok: true, message: `Moved ${formatINR(d.inrAmount)} — ${posted.voucherNo}`, data: { voucherNo: posted.voucherNo } };
  });
}
