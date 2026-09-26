import type { Metadata } from "next";
import { ChangePasswordForm } from "@/components/forms";
import { Icon } from "@/components/ui";
import { requireSession } from "@/lib/session";
import { signOut } from "@/app/actions/auth";

export const metadata: Metadata = { title: "Set a new password" };

/** First login with a temporary password (also reachable by anyone who wants to change it). */
export default async function ChangePasswordPage() {
  const s = await requireSession({ stage: "password" });
  return (
    <div className="min-h-dvh grid place-items-center p-6 bg-gradient-to-br from-sky-50 via-white to-sky-100">
      <div className="w-full max-w-md bg-white rounded-2xl border border-sky-100 shadow-card p-8">
        <div className="h-12 w-12 rounded-xl bg-sky-100 text-sky-600 grid place-items-center text-xl">
          <Icon name="fa-key" />
        </div>
        <h1 className="mt-4 text-xl font-bold">{s.mustChangePassword ? "Set a new password" : "Change password"}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {s.mustChangePassword
            ? `Welcome, ${s.userName}. Your account was created with a temporary password — choose your own before continuing.`
            : "Choose a new password. Your other sessions will be signed out."}
        </p>
        <div className="mt-6">
          <ChangePasswordForm forced={s.mustChangePassword} />
        </div>
        <form action={signOut} className="mt-4 text-center">
          <button className="text-xs text-slate-400 hover:text-sky-700">Sign out</button>
        </form>
      </div>
    </div>
  );
}
