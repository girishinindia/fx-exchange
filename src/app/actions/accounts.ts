"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fieldErrors, optId, optText, runAction, type ActionState } from "@/lib/action";
import { assertPermission } from "@/lib/permissions";
import { saveAccount } from "@/server/services/accounts";

const Account = z.object({
  id: optId(),
  name: z.string().trim().min(2, "Enter the account name").max(120),
  accountType: z.enum(["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"]),
  accountGroup: z.enum(["CASH_BANK", "EXPENSE", "INCOME"]),
  currency: optText(3),
  note: optText(200),
  active: z.any().optional().transform((v) => v === undefined || v === "on" || v === "true" || v === "1"),
});

/** Add a cash/bank, expense or income account; edit the name and note of any account. */
export async function saveAccountAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const s = await assertPermission("account.manage");
    const raw = Object.fromEntries(fd);
    const v = Account.safeParse({ ...raw, id: raw.id || undefined });
    if (!v.success) return { fieldErrors: fieldErrors(v.error) };
    const d = v.data;
    const saved = await saveAccount(s, {
      id: d.id,
      name: d.name,
      accountType: d.accountType,
      accountGroup: d.accountGroup,
      currency: d.currency,
      note: d.note,
      isActive: d.active,
    });
    revalidatePath("/accounts");
    return { ok: true, message: `Account ${saved.code} saved.` };
  });
}
