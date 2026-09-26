"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/lib/db";
import { hashPassword, passwordPolicy, verifyPassword } from "@/lib/password";
import {
  createSession,
  destroyAllSessions,
  destroyOneSession,
  destroySession,
  requestMeta,
  requireSession,
  tenantOf,
} from "@/lib/session";
import { authenticate } from "@/server/services/auth";

export type FormState = { error?: string; fieldErrors?: Record<string, string>; ok?: boolean; message?: string };

const LoginSchema = z.object({
  // one box: an email address or a mobile number. Deliberately not fussy about the shape —
  // the screen's job is to say it did not match, not to argue about somebody's own number.
  login: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(200),
});

// ------------------------------------------------------------------ login
export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = LoginSchema.safeParse({
    login: formData.get("login"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Enter your email address or mobile number, and your password." };
  const { ip, userAgent } = await requestMeta();
  const res = await authenticate({ ...parsed.data, ip, userAgent, context: "web" });
  if (!res.ok) return { error: res.error };
  await createSession(res.data);
  redirect(res.data.mustChangePassword ? "/change-password" : "/dashboard");
}

// ------------------------------------------------------------------ password change
const ChangeSchema = z
  .object({ current: z.string().min(1, "Enter your current password"), next: passwordPolicy, confirm: z.string() })
  .refine((v) => v.next === v.confirm, { path: ["confirm"], message: "Passwords do not match" })
  .refine((v) => v.next !== v.current, { path: ["next"], message: "Choose a different password" });

export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const s = await requireSession({ stage: "password" });
  if (s.preview) return { error: "Not available in preview mode." };
  const parsed = ChangeSchema.safeParse({ current: formData.get("current"), next: formData.get("next"), confirm: formData.get("confirm") });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { fieldErrors };
  }
  const ctx = await tenantOf(s);
  const [row] = await withTenant(ctx, (tx) => tx<{ password_hash: string }[]>`select password_hash from ex.app_user where id = ${s.userId}`);
  if (!row || !(await verifyPassword(row.password_hash, parsed.data.current))) return { fieldErrors: { current: "Current password is incorrect" } };

  const newHash = await hashPassword(parsed.data.next);
  await withTenant(ctx, (tx) => tx`update ex.app_user set password_hash = ${newHash}, must_change_password = false where id = ${s.userId}`);

  // sign out every session (portal and mobile), then start a fresh one here
  await destroyAllSessions(s.companyId, s.userId);
  await createSession({
    userId: s.userId, companyId: s.companyId, companyCode: s.companyCode, companyName: s.companyName,
    userName: s.userName, email: s.email, userType: s.userType, counterName: s.counterName, mustChangePassword: false,
    profileCompleted: s.profileCompleted, companySetUp: s.companySetUp,
  });

  if (s.mustChangePassword) redirect("/dashboard");
  return { ok: true, message: "Password changed. Your other sessions were signed out." };
}

// ------------------------------------------------------------------ sign out
export async function signOut(): Promise<void> {
  await destroySession();
  redirect("/login");
}

export async function signOutEverywhere(): Promise<void> {
  const s = await requireSession();
  if (!s.preview) await destroyAllSessions(s.companyId, s.userId);
  await destroySession();
  redirect("/login");
}

export async function signOutSession(formData: FormData): Promise<void> {
  const s = await requireSession();
  const sid = String(formData.get("sid") ?? "");
  if (!sid || sid === s.sid || s.preview) return;
  await destroyOneSession(s.companyId, s.userId, sid);
  refresh();
}
