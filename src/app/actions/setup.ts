"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { withTenant } from "@/lib/db";
import { patchSession, requireSession, tenantOf } from "@/lib/session";

/**
 * The two things that have to happen before anybody reaches a desk screen: the person says who
 * they are, and the first Administrator says what the company is and what currency it deals in.
 *
 * Both are one-way. A profile can be corrected afterwards from the Profile page; the dealing
 * currency never can — every deposit the desk ever takes is in it.
 */

export type SetupState = { error?: string; ok?: boolean; message?: string };

const opt = (form: FormData, name: string) => form.get(name) ?? undefined;

function fail(e: unknown): SetupState {
  unstable_rethrow(e);
  const msg = e instanceof Error ? e.message : "";
  if (msg && !/^(connect|timeout|ECONN)/i.test(msg)) return { error: msg.replace(/^error:\s*/i, "") };
  console.error(e);
  return { error: "Could not save. Please try again." };
}

export async function completeProfileAction(_prev: SetupState, form: FormData): Promise<SetupState> {
  const s = await requireSession({ stage: "profile" });
  const parsed = z.object({
    fullName: z.string().trim().min(2, "Enter your full name").max(120),
    phone: z.string().trim().max(20).optional().transform((v) => v || null),
  }).safeParse({ fullName: form.get("fullName"), phone: opt(form, "phone") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await withTenant(await tenantOf(s), (tx) =>
      tx`select ex.fn_complete_profile(${tx.json({ full_name: parsed.data.fullName, phone: parsed.data.phone } as never)})`);
    await patchSession(s.sid, { profileCompleted: true, userName: parsed.data.fullName });
  } catch (e) { return fail(e); }
  redirect(s.companySetUp ? "/dashboard" : "/setup");
}

export async function completeCompanySetupAction(_prev: SetupState, form: FormData): Promise<SetupState> {
  const s = await requireSession({ stage: "company" });
  const parsed = z.object({
    legalName: z.string().trim().min(2, "Enter the company's registered name").max(200),
    displayName: z.string().trim().max(200).optional().transform((v) => v || null),
    primaryCurrency: z.string().trim().toUpperCase().length(3, "Choose the currency this desk deals in"),
    phone: z.string().trim().max(20).optional().transform((v) => v || null),
    email: z.string().trim().max(200).optional().transform((v) => v || null),
    address: z.string().trim().max(300).optional().transform((v) => v || null),
    city: z.string().trim().max(80).optional().transform((v) => v || null),
    state: z.string().trim().max(80).optional().transform((v) => v || null),
    pincode: z.string().trim().max(12).optional().transform((v) => v || null),
    gstin: z.string().trim().max(20).optional().transform((v) => v || null),
    pan: z.string().trim().max(12).optional().transform((v) => v || null),
    licenseNo: z.string().trim().max(60).optional().transform((v) => v || null),
  }).safeParse({
    legalName: form.get("legalName"), displayName: opt(form, "displayName"),
    primaryCurrency: form.get("primaryCurrency"), phone: opt(form, "phone"), email: opt(form, "email"),
    address: opt(form, "address"), city: opt(form, "city"), state: opt(form, "state"),
    pincode: opt(form, "pincode"), gstin: opt(form, "gstin"), pan: opt(form, "pan"),
    licenseNo: opt(form, "licenseNo"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  try {
    const [r] = await withTenant(await tenantOf(s), (tx) =>
      tx<{ v: Record<string, string> }[]>`select ex.fn_complete_company_setup(${tx.json({
        legal_name: d.legalName, display_name: d.displayName, primary_currency: d.primaryCurrency,
        phone: d.phone, email: d.email, address: d.address, city: d.city, state: d.state,
        pincode: d.pincode, gstin: d.gstin, pan: d.pan, license_no: d.licenseNo,
      } as never)}) as v`);
    await patchSession(s.sid, { companySetUp: true, companyName: String(r.v.display_name ?? d.legalName) });
  } catch (e) { return fail(e); }
  redirect("/dashboard?setup=done");
}
