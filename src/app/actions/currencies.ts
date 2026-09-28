"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkbox, runAction, type ActionState } from "@/lib/action";
import { assertPermission } from "@/lib/permissions";
import { enableCurrency as enable, EnableCurrency, updateCurrency as update } from "@/server/services/admin";

/**
 * Thin form adapters over server/services/admin — the same code /api/v1/currencies runs, so the
 * phone and the browser enforce the same rules (the book and dealing currencies can never be
 * switched off). min_stock_alert is deliberately not written by either action any more.
 */
export async function enableCurrency(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const s = await assertPermission("currency.manage");
    const v = EnableCurrency.safeParse(Object.fromEntries(fd));
    if (!v.success) return { error: v.error.issues[0]?.message };
    const { code } = await enable(s, v.data);
    revalidatePath("/admin/currencies");
    revalidatePath("/accounts");
    return { ok: true, message: `${code} enabled — a cash/bank account was created for it.` };
  });
}

const UpdateForm = z.object({
  id: z.coerce.number().int().positive(),
  order: z.coerce.number().int().min(0).max(999),
  active: checkbox,
});

export async function updateCurrency(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const s = await assertPermission("currency.manage");
    const v = UpdateForm.safeParse(Object.fromEntries(fd));
    if (!v.success) return { error: v.error.issues[0]?.message };
    await update(s, { id: v.data.id, order: v.data.order, active: Boolean(v.data.active) });
    revalidatePath("/admin/currencies");
    revalidatePath("/accounts");
    return { ok: true, message: "Currency updated." };
  });
}
