"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fieldErrors, optText, runAction, type ActionState } from "@/lib/action";
import { withTenant } from "@/lib/db";
import { assertPermission } from "@/lib/permissions";
import { tenantOf } from "@/lib/session";

// ------------------------------------------------------------------ company profile
const Profile = z.object({
  legalName: z.string().trim().min(2, "Enter the legal name").max(200),
  displayName: optText(120),
  gstin: optText(20).refine((v) => v === null || /^[0-9A-Z]{15}$/.test(v.toUpperCase()), "GSTIN must be 15 characters"),
  pan: optText(10).refine((v) => v === null || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v.toUpperCase()), "PAN format: AAAAA9999A"),
  licenseNo: optText(60),
  phone: optText(20),
  email: optText(200).refine((v) => v === null || z.string().email().safeParse(v).success, "Enter a valid email"),
  address: optText(300),
  city: optText(80),
  state: optText(80),
  pincode: optText(10).refine((v) => v === null || /^\d{6}$/.test(v), "PIN code must be 6 digits"),
});

export async function saveCompanyProfile(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const s = await assertPermission("company.manage");
    const v = Profile.safeParse(Object.fromEntries(fd));
    if (!v.success) return { fieldErrors: fieldErrors(v.error) };
    const d = v.data;
    await withTenant(await tenantOf(s), (tx) => tx`
      update ex.company set legal_name = ${d.legalName}, display_name = ${d.displayName},
             gstin = ${d.gstin?.toUpperCase() ?? null}, pan = ${d.pan?.toUpperCase() ?? null}, license_no = ${d.licenseNo},
             phone = ${d.phone}, email = ${d.email}, address = ${d.address}, city = ${d.city}, state = ${d.state}, pincode = ${d.pincode}
       where id = ${s.companyId}`);
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
