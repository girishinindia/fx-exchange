"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fieldErrors, runAction, type ActionState } from "@/lib/action";
import { requireSession } from "@/lib/session";
import { lockFinancialYear, revalue, reverseVoucher, unlockFinancialYear } from "@/server/services/yearend";

const Reversal = z.object({
  id: z.coerce.number().int().positive(),   // ReasonForm posts the record id as "id"
  reason: z.string().trim().min(5, "Say why in a few words — it stays on the record").max(300),
});

/** Cancel a posted voucher with an equal and opposite one. The original is never touched. */
export async function reverseVoucherAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const s = await requireSession();
    const v = Reversal.safeParse(Object.fromEntries(fd));
    if (!v.success) return { fieldErrors: fieldErrors(v.error), error: v.error.issues[0]?.message };
    const done = await reverseVoucher(s, v.data.id, v.data.reason);
    revalidatePath("/vouchers");
    revalidatePath("/dashboard");
    revalidatePath(`/vouchers/${v.data.id}`);
    return { ok: true, message: `${done.reversed} reversed by ${done.voucherNo}.` };
  });
}

const Lock = z.object({
  fyId: z.coerce.number().int().positive(),
  note: z.string().trim().max(300).optional().or(z.literal("")),
});

export async function lockYearAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const s = await requireSession();
    const v = Lock.safeParse(Object.fromEntries(fd));
    if (!v.success) return { fieldErrors: fieldErrors(v.error) };
    const done = await lockFinancialYear(s, v.data.fyId, v.data.note ?? "");
    revalidatePath("/admin/year-end");
    return { ok: true, message: `${done.fyCode} is closed. Nothing more can be entered in it.` };
  });
}

const Unlock = z.object({
  id: z.coerce.number().int().positive(),   // ReasonForm posts the record id as "id"
  reason: z.string().trim().min(5, "Say why the year is being reopened").max(300),
});

export async function unlockYearAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const s = await requireSession();
    const v = Unlock.safeParse(Object.fromEntries(fd));
    if (!v.success) return { fieldErrors: fieldErrors(v.error), error: v.error.issues[0]?.message };
    const done = await unlockFinancialYear(s, v.data.id, v.data.reason);
    revalidatePath("/admin/year-end");
    return { ok: true, message: `${done.fyCode} is open again. The reason is on the record.` };
  });
}

/** Restate held currency and currency owed to clients at the closing rates. */
export async function revalueAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const s = await requireSession();
    const date = String(fd.get("date") ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Choose the closing date." };

    const rates: { currency: string; rate: string }[] = [];
    for (const [key, raw] of fd.entries()) {
      const m = /^rate-([A-Za-z]{3})$/.exec(key);
      if (!m || typeof raw !== "string") continue;
      const rate = raw.trim();
      if (!rate) continue;
      if (!/^\d{1,12}(\.\d{1,6})?$/.test(rate) || Number(rate) <= 0) {
        return { error: `${m[1].toUpperCase()}: enter the closing rate as a number.` };
      }
      rates.push({ currency: m[1].toUpperCase(), rate });
    }
    if (rates.length === 0) return { error: "Enter a closing rate for at least one currency." };

    const done = await revalue(s, rates, date, String(fd.get("narration") ?? "").trim() || undefined);
    revalidatePath("/admin/year-end");
    revalidatePath("/dashboard");
    if (done.nothingToDo) return { ok: true, message: "Nothing to restate — the rates given are the rates already carried." };
    const gain = Number(done.gainInr);
    return {
      ok: true,
      message: `${done.voucherNo} posted. ${gain === 0 ? "No gain or loss — the position was matched." : gain > 0 ? `Unrealised gain ₹${done.gainInr}.` : `Unrealised loss ₹${(-gain).toFixed(2)}.`}`,
    };
  });
}
