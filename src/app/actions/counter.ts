"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { decimalStr, fieldErrors, optText, runAction, type ActionState } from "@/lib/action";
import { formatINR, formatQty } from "@/lib/money";
import { requireSession } from "@/lib/session";
import { postPurchase, postSale } from "@/server/services/counter";

const Sale = z.object({
  clientId: z.coerce.number().int().positive("Choose the client"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date"),
  fxCurrency: z.string().trim().regex(/^[A-Za-z]{3}$/, "Choose the currency").transform((v) => v.toUpperCase()),
  fxAmount: decimalStr("Amount", 4),
  fxToInrRate: decimalStr("Rate", 6),
  srcAmount: decimalStr("USD it costs", 4),
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

const refresh = () => { for (const p of ["/entry", "/home", "/money", "/dashboard", "/deals", "/deposits", "/payouts", "/receipts", "/settlements", "/vouchers"]) revalidatePath(p); };

/** The counter's Sell: a deal, and — ticked — the hand-over and the receipt with it, all or nothing. */
export async function postSaleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const s = await requireSession();
    const v = Sale.safeParse(Object.fromEntries(fd));
    if (!v.success) return { fieldErrors: fieldErrors(v.error), error: v.error.issues[0]?.message };
    const d = v.data;
    const posted = await postSale(s, {
      deal: { clientId: d.clientId, date: d.date, fxCurrency: d.fxCurrency, fxAmount: d.fxAmount, fxToInrRate: d.fxToInrRate, srcAmount: d.srcAmount,
        referenceNo: d.referenceNo, narration: d.narration, rateJustification: d.rateJustification, clientRef: d.clientRef },
      handOver: fd.get("handOver") === "on" ? { accountCode: (fd.get("handOverAccount") as string) || null } : null,
      collect: fd.get("collect") === "on" ? { accountCode: (fd.get("collectAccount") as string) || null } : null,
    });
    refresh();
    const bits = [`Sold ${formatQty(posted.deal.fxAmount)} ${d.fxCurrency} — ${posted.deal.voucherNo}, margin ${formatINR(posted.deal.marginInr)}`];
    if (posted.payout) bits.push(`handed over (${posted.payout.voucherNo})`);
    if (posted.receipt) bits.push(`${formatINR(posted.receipt.inrAmount)} received (${posted.receipt.voucherNo})`);
    return { ok: true, message: bits.join(" · "), data: { dealId: posted.deal.id, voucherNo: posted.deal.voucherNo } };
  });
}

/** The counter's Buy: a deposit, and — ticked — the settlement with it. */
export async function postPurchaseAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const s = await requireSession();
    const v = Purchase.safeParse(Object.fromEntries(fd));
    if (!v.success) return { fieldErrors: fieldErrors(v.error), error: v.error.issues[0]?.message };
    const d = v.data;
    const payNow = fd.get("payNow") === "on";
    if (payNow && !/^\d{1,9}(\.\d{1,6})?$/.test(d.payRate ?? "")) return { error: "Type the rate you are paying the depositor at today.", fieldErrors: { payRate: "Rate needed" } };
    const posted = await postPurchase(s, {
      deposit: { depositorId: d.depositorId, date: d.date, currency: d.currency, fxAmount: d.fxAmount,
        toPrimaryRate: d.toPrimaryRate && d.toPrimaryRate !== "" ? d.toPrimaryRate : null, rate: d.rate,
        referenceNo: d.referenceNo, narration: d.narration, rateJustification: d.rateJustification, clientRef: d.clientRef },
      payNow: payNow ? { rate: d.payRate!, accountCode: (fd.get("payAccount") as string) || null } : null,
    });
    refresh();
    const bits = [`Bought ${formatQty(posted.deposit.fxAmount)} — ${posted.deposit.voucherNo}, worth ${formatINR(posted.deposit.inrAmount)}`];
    if (posted.settlement) bits.push(`paid ${formatINR(posted.settlement.inrAmount)} (${posted.settlement.voucherNo})`);
    return { ok: true, message: bits.join(" · "), data: { depositId: posted.deposit.id, voucherNo: posted.deposit.voucherNo } };
  });
}
