"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { decimalStr, fieldErrors, optText, runAction, type ActionState } from "@/lib/action";
import { requireSession } from "@/lib/session";
import { postDeal, type FundingSlice } from "@/server/services/deals";

const Deal = z.object({
  clientId: z.coerce.number().int().positive("Choose the client"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date"),
  fxCurrency: z.string().trim().regex(/^[A-Za-z]{3}$/, "Choose the currency").transform((v) => v.toUpperCase()),
  fxAmount: decimalStr("Currency amount", 4),
  fxToInrRate: decimalStr("Billing rate", 6),
  srcAmount: decimalStr("Amount spent", 4),
  referenceNo: optText(60),
  narration: optText(300),
  rateJustification: optText(300),
  clientRef: optText(80),
});

/**
 * Book a deal. Funding is either left to the database (oldest deposit first) or given
 * slice by slice as fund-<depositId> fields — whatever the desk actually agreed.
 */
export async function postDealAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const res = await runAction(async () => {
    const s = await requireSession();
    const v = Deal.safeParse(Object.fromEntries(fd));
    if (!v.success) return { fieldErrors: fieldErrors(v.error), error: v.error.issues[0]?.message };

    const funding: FundingSlice[] = [];
    for (const [key, raw] of fd.entries()) {
      const m = /^fund-(\d+)$/.exec(key);
      if (!m || typeof raw !== "string") continue;
      const amount = raw.trim();
      if (!amount || Number(amount) === 0) continue;
      if (!/^\d{1,15}(\.\d{1,4})?$/.test(amount)) return { error: `Allocation for deposit ${m[1]}: enter a number` };
      funding.push({ depositId: Number(m[1]), fxAllocated: amount });
    }

    const d = v.data;
    const posted = await postDeal(s, {
      clientId: d.clientId,
      date: d.date,
      fxCurrency: d.fxCurrency,
      fxAmount: d.fxAmount,
      fxToInrRate: d.fxToInrRate,
      srcAmount: d.srcAmount,
      funding: fd.get("auto") === "on" ? undefined : funding,
      referenceNo: d.referenceNo,
      narration: d.narration,
      rateJustification: d.rateJustification,
      clientRef: d.clientRef,
    });
    revalidatePath("/deals");
    revalidatePath("/deposits");
    revalidatePath("/dashboard");
    target = `/deals/${posted.id}`;
    return {
      ok: true,
      message: posted.duplicate
        ? `Already booked as ${posted.voucherNo}.`
        : `Booked ${posted.voucherNo} — margin ₹${posted.marginInr}.`,
    };
  });
  if (res.ok && target) redirect(target);
  return res;
}
