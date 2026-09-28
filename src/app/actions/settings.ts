"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fieldErrors, runAction, type ActionState } from "@/lib/action";
import { CompanyProfile, saveCompanyProfile as save } from "@/server/services/admin";
import { withTenant } from "@/lib/db";
import { assertPermission } from "@/lib/permissions";
import { tenantOf } from "@/lib/session";

// ------------------------------------------------------------------ company profile
// The schema and the update live in server/services/admin so /api/v1/company is the same code.
export async function saveCompanyProfile(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const s = await assertPermission("company.manage");
    const v = CompanyProfile.safeParse(Object.fromEntries(fd));
    if (!v.success) return { fieldErrors: fieldErrors(v.error) };
    await save(s, v.data);
    revalidatePath("/", "layout");
    return { ok: true, message: "Company profile saved." };
  });
}

// ------------------------------------------------------------------ books
const Books = z.object({
  booksStart: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date the books start").optional().or(z.literal("")),
});

/**
 * Only the date the books open. The other two are no longer anybody's to set:
 *   · the financial year runs 1 April to 31 March, held by a database constraint;
 *   · the dealing currency is chosen once, when the company is set up, and locked there.
 * Both used to live on this form. Taking them off it is the point — a setting that can be
 * changed after the first voucher is a setting that can quietly falsify a year of trading.
 */
export async function saveBooks(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const s = await assertPermission("company.manage");
    const v = Books.safeParse(Object.fromEntries(fd));
    if (!v.success) return { fieldErrors: fieldErrors(v.error) };
    await withTenant(await tenantOf(s), (tx) =>
      tx`update ex.company set books_start_date = ${v.data.booksStart || null} where id = ${s.companyId}`);
    revalidatePath("/", "layout");
    return { ok: true, message: "Saved." };
  });
}
