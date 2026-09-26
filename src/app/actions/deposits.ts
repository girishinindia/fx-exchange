"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { decimalStr, fieldErrors, optDecimalStr, optText, runAction, type ActionState } from "@/lib/action";
import { requireSession } from "@/lib/session";
import { postDeposit, postSettlement } from "@/server/services/deposits";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date");

const Deposit = z.object({
  depositorId: z.coerce.number().int().positive("Choose the depositor"),
  date: DATE,
  currency: optText(3),
  fxAmount: decimalStr("Amount", 4),
  /** only when the depositor handed over something other than the dealing currency */
  toPrimaryRate: optDecimalStr("Rate", 6),
  rate: decimalStr("Rate", 6),
  referenceNo: optText(60),
  narration: optText(300),
  rateJustification: optText(300),
  clientRef: optText(80),
});

/** Record currency brought in by a depositor. */
export async function postDepositAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const res = await runAction(async () => {
    const s = await requireSession();
    const v = Deposit.safeParse(Object.fromEntries(fd));
    if (!v.success) return { fieldErrors: fieldErrors(v.error), error: v.error.issues[0]?.message };
    const d = v.data;
    const posted = await postDeposit(s, {
      depositorId: d.depositorId,
      date: d.date,
      currency: d.currency,
      fxAmount: d.fxAmount,
      toPrimaryRate: d.toPrimaryRate,
      rate: d.rate,
      referenceNo: d.referenceNo,
      narration: d.narration,
      rateJustification: d.rateJustification,
      clientRef: d.clientRef,
    });
    revalidatePath("/deposits");
    revalidatePath("/dashboard");
    target = `/vouchers/${posted.voucherId}`;
    return { ok: true, message: posted.duplicate ? `Already recorded as ${posted.voucherNo}.` : `Recorded ${posted.voucherNo}.` };
  });
  if (res.ok && target) redirect(target);
  return res;
}

const Settlement = z.object({
  depositorId: z.coerce.number().int().positive("Choose the depositor"),
  date: DATE,
  currency: optText(3),
  fxAmount: decimalStr("Amount", 4),
  rate: optDecimalStr("Rate", 6),
  accountCode: optText(30),
  referenceNo: optText(60),
  narration: optText(300),
  clientRef: optText(80),
});

/**
 * Pay a depositor back — in full or in part.
 *
 * The amount is in the currency they are owed, and the rate is the one agreed today. The
 * database releases the promise at what it is carried at, pays the rupees at the agreed rate,
 * and records the difference as a gain or a loss; none of that is worked out here.
 */
export async function postSettlementAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const res = await runAction(async () => {
    const s = await requireSession();
    const v = Settlement.safeParse(Object.fromEntries(fd));
    if (!v.success) return { fieldErrors: fieldErrors(v.error), error: v.error.issues[0]?.message };
    const d = v.data;
    const posted = await postSettlement(s, {
      depositorId: d.depositorId,
      date: d.date,
      currency: d.currency,
      fxAmount: d.fxAmount,
      rate: d.rate,
      accountCode: d.accountCode,
      referenceNo: d.referenceNo,
      narration: d.narration,
      clientRef: d.clientRef,
    });
    revalidatePath("/settlements");
    revalidatePath("/deposits");
    revalidatePath("/dashboard");
    target = `/vouchers/${posted.id}`;
    const moved = Number(posted.gainInr);
    const note = moved > 1 ? ` The rate moved your way: ₹${posted.gainInr} to FX Margin.`
               : moved < -1 ? ` The rate moved against you: ₹${(-moved).toFixed(2)} to Exchange Loss.`
               : "";
    return { ok: true, message: `Paid ${posted.voucherNo} — ₹${posted.inrAmount} for ${posted.fxAmount} ${posted.currency} at ${posted.rate}.`
      + ` Still owed: ${posted.nowOwedFx} ${posted.currency}.${note}` };
  });
  if (res.ok && target) redirect(target);
  return res;
}
