"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { checkbox, decimalStr, fieldErrors, optText, runAction, type ActionState } from "@/lib/action";
import { requireSession } from "@/lib/session";
import { postPayout, postReceipt } from "@/server/services/clients";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date");

const Payout = z.object({
  clientId: z.coerce.number().int().positive("Choose the client"),
  date: DATE,
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "Choose the currency").transform((v) => v.toUpperCase()),
  fxAmount: decimalStr("Amount", 4),
  accountCode: optText(30),
  referenceNo: optText(60),
  narration: optText(300),
  clientRef: optText(80),
});

/** Hand currency over to a client — all of it, or part. */
export async function postPayoutAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const res = await runAction(async () => {
    const s = await requireSession();
    const v = Payout.safeParse(Object.fromEntries(fd));
    if (!v.success) return { fieldErrors: fieldErrors(v.error), error: v.error.issues[0]?.message };
    const d = v.data;
    const posted = await postPayout(s, {
      clientId: d.clientId, date: d.date, currency: d.currency, fxAmount: d.fxAmount,
      accountCode: d.accountCode, referenceNo: d.referenceNo, narration: d.narration, clientRef: d.clientRef,
    });
    revalidatePath("/payouts");
    revalidatePath("/deals");
    revalidatePath("/dashboard");
    target = `/vouchers/${posted.id}`;
    return {
      ok: true,
      message: Number(posted.nowDueFx) > 0
        ? `${posted.voucherNo}. Still to deliver: ${posted.nowDueFx} ${posted.currency}.`
        : `${posted.voucherNo}. This client's ${posted.currency} is fully delivered.`,
    };
  });
  if (res.ok && target) redirect(target);
  return res;
}

const Receipt = z.object({
  clientId: z.coerce.number().int().positive("Choose the client"),
  date: DATE,
  inrAmount: decimalStr("Amount", 2),
  accountCode: optText(30),
  allowAdvance: checkbox,
  referenceNo: optText(60),
  narration: optText(300),
  clientRef: optText(80),
});

/** Take rupees from a client, against what they were billed. */
export async function postReceiptAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const res = await runAction(async () => {
    const s = await requireSession();
    const v = Receipt.safeParse(Object.fromEntries(fd));
    if (!v.success) return { fieldErrors: fieldErrors(v.error), error: v.error.issues[0]?.message };
    const d = v.data;
    const posted = await postReceipt(s, {
      clientId: d.clientId, date: d.date, inrAmount: d.inrAmount, accountCode: d.accountCode,
      allowAdvance: d.allowAdvance, referenceNo: d.referenceNo, narration: d.narration, clientRef: d.clientRef,
    });
    revalidatePath("/receipts");
    revalidatePath("/settlements");
    revalidatePath("/dashboard");
    target = `/vouchers/${posted.id}`;
    const advance = Number(posted.advanceInr) > 0 ? ` ₹${posted.advanceInr} of it is an advance.` : "";
    return { ok: true, message: `${posted.voucherNo}. Still owed: ₹${Math.max(Number(posted.nowOwed), 0).toFixed(2)}.${advance}` };
  });
  if (res.ok && target) redirect(target);
  return res;
}
