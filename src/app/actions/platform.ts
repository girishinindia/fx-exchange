"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { passwordPolicy } from "@/lib/password";
import {
  createPlatformSession, destroyAllPlatformSessions, destroyPlatformSession,
  patchPlatformSession, requirePlatformSession,
} from "@/lib/platform-session";
import * as P from "@/server/platform";
import { requestMeta } from "@/lib/session";

/**
 * What a Super Admin can do, as server actions. Every one of them re-reads the console session
 * first — a form post is not trusted to say who sent it — and every one ends in a database
 * function that records the actor.
 */

export type ConsoleState = {
  error?: string; ok?: boolean; message?: string;
  password?: string; forEmail?: string;   // a temporary password, shown once and never stored
};

/**
 * A field that is not on the form at all comes back as null, and zod's .optional() only accepts
 * undefined — so an absent optional field fails validation instead of being absent. Read every
 * optional field through this.
 */
const opt = (form: FormData, name: string) => form.get(name) ?? undefined;

function fail(e: unknown): ConsoleState {
  unstable_rethrow(e);
  const msg = e instanceof Error ? e.message : "";
  // the database's own refusals are written for a person; pass them straight through
  if (msg && !/^(connect|timeout|ECONN)/i.test(msg)) return { error: msg.replace(/^error:\s*/i, "") };
  console.error(e);
  return { error: "Could not do that. Please try again." };
}

// ------------------------------------------------------------------ signing in and out

export async function platformLoginAction(_prev: ConsoleState, form: FormData): Promise<ConsoleState> {
  const parsed = z.object({
    login: z.string().trim().min(3, "Enter your email address or mobile number").max(200),
    password: z.string().min(1, "Enter your password"),
  }).safeParse({ login: form.get("login"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { ip } = await requestMeta();
  const res = await P.authenticatePlatform({ ...parsed.data, ip });
  if (!res.ok) return { error: res.error };

  await createPlatformSession(res.data);
  redirect(res.data.mustChangePassword ? "/platform/password" : "/platform");
}

export async function platformLogoutAction(): Promise<void> {
  await destroyPlatformSession();
  redirect("/platform/login");
}

export async function platformPasswordAction(_prev: ConsoleState, form: FormData): Promise<ConsoleState> {
  const s = await requirePlatformSession({ allowPasswordChange: true });
  const parsed = z.object({
    password: passwordPolicy,
    confirm: z.string(),
  }).refine((v) => v.password === v.confirm, { message: "The two passwords do not match", path: ["confirm"] })
    .safeParse({ password: form.get("password"), confirm: form.get("confirm") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await P.setOwnPassword(s, parsed.data.password);
    await destroyAllPlatformSessions(s.userId, s.sid);
    await patchPlatformSession(s.sid, { mustChangePassword: false });
  } catch (e) { return fail(e); }
  redirect("/platform");
}

// ------------------------------------------------------------------ companies

export async function createCompanyAction(_prev: ConsoleState, form: FormData): Promise<ConsoleState> {
  const s = await requirePlatformSession();
  const parsed = z.object({
    // no code: the database assigns one, atomically, so two Super Admins opening accounts at
    // the same moment cannot be handed the same one
    legalName: z.string().trim().min(2, "Enter the company's registered name").max(200),
    adminName: z.string().trim().min(2, "Enter the first Administrator's name").max(120),
    adminEmail: z.string().trim().toLowerCase().email("Enter the Administrator's email address").max(200),
    adminPhone: z.string().trim().max(20).optional().transform((v) => v || null),
  }).safeParse({
    legalName: form.get("legalName"),
    adminName: form.get("adminName"), adminEmail: form.get("adminEmail"),
    adminPhone: opt(form, "adminPhone"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const out = await P.createCompany(s, parsed.data);
    revalidatePath("/platform");
    return {
      ok: true, password: out.password, forEmail: out.adminEmail,
      message: `${out.code} is open. Hand this password to ${out.adminEmail} — they will set the company up and choose its dealing currency when they first sign in.`,
    };
  } catch (e) { return fail(e); }
}

export async function setCompanyStatusAction(_prev: ConsoleState, form: FormData): Promise<ConsoleState> {
  const s = await requirePlatformSession();
  const parsed = z.object({
    companyId: z.coerce.number().int().positive(),
    status: z.enum(["ACTIVE", "SUSPENDED", "CLOSED"]),
    reason: z.string().trim().max(300).optional().transform((v) => v ?? ""),
  }).safeParse({ companyId: form.get("companyId"), status: form.get("status"), reason: opt(form, "reason") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const out = await P.setCompanyStatus(s, parsed.data.companyId, parsed.data.status, parsed.data.reason);
    revalidatePath("/platform");
    revalidatePath(`/platform/companies/${parsed.data.companyId}`);
    return {
      ok: true,
      message: out.status === "ACTIVE"
        ? `${out.code} can sign in again.`
        : `${out.code} is blocked. Nobody there can sign in until it is let back in.`,
    };
  } catch (e) { return fail(e); }
}

/**
 * Erase a company. Guarded here only so the form can say something sensible; the refusing
 * that matters is done by the database, which will not delete a company that is still
 * running, or one whose code was not typed out exactly.
 */
export async function deleteCompanyAction(_prev: ConsoleState, form: FormData): Promise<ConsoleState> {
  const s = await requirePlatformSession();
  const parsed = z.object({
    companyId: z.coerce.number().int().positive(),
    confirmCode: z.string().trim().min(1, "Type the company code to confirm"),
    reason: z.string().trim().min(10, "Say why this account is being deleted — at least a few words"),
    // the screen said "block and delete": the caller is telling the database it knows the
    // company is still running
    blockFirst: z.coerce.boolean().optional().transform((v) => v === true),
  }).safeParse({
    companyId: form.get("companyId"), confirmCode: form.get("confirmCode"), reason: form.get("reason"),
    blockFirst: form.get("blockFirst") === "1",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  let done: { code: string; was: { vouchers: number; parties: number; people: number } };
  try {
    const out = await P.deleteCompany(
      s, parsed.data.companyId, parsed.data.confirmCode, parsed.data.reason, parsed.data.blockFirst);
    revalidatePath("/platform");
    done = out;
  } catch (e) { return fail(e); }

  // The page this was submitted from is the company's own, and that company no longer
  // exists — staying on it means a 404. Go back to the list and say what happened there.
  const n = done.was;
  const held = n.vouchers > 0
    ? `${n.vouchers} voucher${n.vouchers === 1 ? "" : "s"}, ${n.parties} ${n.parties === 1 ? "party" : "parties"} and ${n.people} ${n.people === 1 ? "person" : "people"}`
    : "";
  redirect(`/platform?deleted=${encodeURIComponent(done.code)}${held ? `&held=${encodeURIComponent(held)}` : ""}`);
}

// ------------------------------------------------------------------ people

export async function createUserAction(_prev: ConsoleState, form: FormData): Promise<ConsoleState> {
  const s = await requirePlatformSession();
  const parsed = z.object({
    companyId: z.coerce.number().int().positive(),
    fullName: z.string().trim().min(2, "Enter their name").max(120),
    email: z.string().trim().toLowerCase().email("Enter their email address").max(200),
    phone: z.string().trim().max(20).optional().transform((v) => v || null),
    userType: z.enum(["ADMIN", "USER"]),
  }).safeParse({
    companyId: form.get("companyId"), fullName: form.get("fullName"),
    email: form.get("email"), phone: opt(form, "phone"), userType: form.get("userType"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const out = await P.createUser(s, parsed.data);
    revalidatePath(`/platform/companies/${parsed.data.companyId}`);
    return {
      ok: true, password: out.password, forEmail: out.email,
      message: `${out.fullName} can sign in now. They will be asked to set their own password and fill in their profile.`,
    };
  } catch (e) { return fail(e); }
}

export async function setUserStatusAction(_prev: ConsoleState, form: FormData): Promise<ConsoleState> {
  const s = await requirePlatformSession();
  const parsed = z.object({
    companyId: z.coerce.number().int().positive(),
    userId: z.coerce.number().int().positive(),
    status: z.enum(["ACTIVE", "INACTIVE"]),
  }).safeParse({ companyId: form.get("companyId"), userId: form.get("userId"), status: form.get("status") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const out = await P.setUserStatus(s, parsed.data.companyId, parsed.data.userId, parsed.data.status);
    revalidatePath(`/platform/companies/${parsed.data.companyId}`);
    return {
      ok: true,
      message: out.status === "ACTIVE" ? `${out.fullName} can sign in again.` : `${out.fullName} is blocked.`,
    };
  } catch (e) { return fail(e); }
}

export async function resetUserPasswordAction(_prev: ConsoleState, form: FormData): Promise<ConsoleState> {
  const s = await requirePlatformSession();
  const parsed = z.object({
    companyId: z.coerce.number().int().positive(),
    userId: z.coerce.number().int().positive(),
  }).safeParse({ companyId: form.get("companyId"), userId: form.get("userId") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const out = await P.resetUserPassword(s, parsed.data.companyId, parsed.data.userId);
    revalidatePath(`/platform/companies/${parsed.data.companyId}`);
    return {
      ok: true, password: out.password, forEmail: out.email,
      message: `${out.fullName} will be asked to set a new password when they next sign in.`,
    };
  } catch (e) { return fail(e); }
}
