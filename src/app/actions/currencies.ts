"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkbox, RuleError, runAction, type ActionState } from "@/lib/action";
import { withTenant } from "@/lib/db";
import { assertPermission } from "@/lib/permissions";
import { tenantOf } from "@/lib/session";

/**
 * min_stock_alert is deliberately not written by either action any more. It was the retail
 * counter's low-stock warning; nothing in the wholesale desk ever reads it, and leaving it on
 * the form invited somebody to set a threshold that would never fire. The column and whatever
 * is already in it are left alone rather than dropped, pending a decision on whether a
 * minimum-holding warning belongs on the liquidity dashboard.
 */
const Enable = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Choose a currency"),
  order: z.coerce.number().int().min(0).max(999).default(10),
});

export async function enableCurrency(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const s = await assertPermission("currency.manage");
    const v = Enable.safeParse(Object.fromEntries(fd));
    if (!v.success) return { error: v.error.issues[0]?.message };
    const d = v.data;
    await withTenant(await tenantOf(s), async (tx) => {
      const [m] = await tx<{ code: string }[]>`select code from ex.currency_master where code = ${d.code} and is_active`;
      if (!m) throw new RuleError("Unknown currency.");
      await tx`
        insert into ex.company_currency (currency_code, display_order, is_active)
        values (${d.code}, ${d.order}, true)
        on conflict (company_id, currency_code) do update set is_active = true, display_order = excluded.display_order`;
    });
    revalidatePath("/admin/currencies");
    revalidatePath("/accounts");
    return { ok: true, message: `${d.code} enabled — a cash/bank account was created for it.` };
  });
}

const Update = z.object({
  id: z.coerce.number().int().positive(),
  order: z.coerce.number().int().min(0).max(999),
  active: checkbox,
});

export async function updateCurrency(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const s = await assertPermission("currency.manage");
    const v = Update.safeParse(Object.fromEntries(fd));
    if (!v.success) return { error: v.error.issues[0]?.message };
    const d = v.data;
    await withTenant(await tenantOf(s), async (tx) => {
      // The two currencies the company cannot trade without: the one the books are kept in and
      // the one depositors bring in. Both are fixed at setup, so neither may be switched off —
      // the screen does not offer it, and this is the check that means it.
      const [c] = await tx<{ currency_code: string; is_base: boolean; is_primary: boolean }[]>`
        select cc.currency_code, cc.is_base, (cc.currency_code = co.primary_currency_code) as is_primary
          from ex.company_currency cc
          join ex.company co on co.id = ex.current_company_id()
         where cc.id = ${d.id}`;
      if (!c) throw new RuleError("Currency not found.");
      if (c.is_base && !d.active) throw new RuleError("The books are kept in this currency — it cannot be switched off.");
      if (c.is_primary && !d.active) throw new RuleError("Every deposit comes in in this currency — it cannot be switched off.");
      await tx`update ex.company_currency set display_order = ${d.order}, is_active = ${d.active} where id = ${d.id}`;
    });
    revalidatePath("/admin/currencies");
    revalidatePath("/accounts");
    return { ok: true, message: "Currency updated." };
  });
}
