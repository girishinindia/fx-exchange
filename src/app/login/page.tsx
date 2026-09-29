import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUiMode } from "@/lib/ui-mode";
import { Icon } from "@/components/ui";
import { LoginForm } from "@/components/forms";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in" };

/** Login: company code + email + password. No self sign-up — users are created by an Admin. */
export default async function LoginPage() {
  const s = await getSession();
  if (s && !s.preview) redirect(s.mustChangePassword ? "/change-password" : (await getUiMode()) === "simple" ? "/home" : "/dashboard");

  return (
    <div className="min-h-dvh grid lg:grid-cols-2 bg-gradient-to-br from-sky-50 via-white to-sky-100">
      <div className="hidden lg:flex flex-col justify-between p-12 bg-gradient-to-br from-sky-600 to-sky-800 text-white relative overflow-hidden">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-white/15 grid place-items-center text-xl">
            <Icon name="fa-coins" />
          </div>
          <div className="text-xl font-bold">FX Desk</div>
        </div>
        <div>
          <h1 className="text-3xl font-bold leading-snug">
            Buy, sell and track every currency
            <br />— with profit on every deal.
          </h1>
          <ul className="mt-8 space-y-3 text-sky-100">
            {["Live stock and average cost for each currency", "Customer-wise rates, balances and history", "Daily, monthly and yearly profit & loss", "Full audit trail of every change"].map((t) => (
              <li key={t} className="flex gap-3">
                <Icon name="fa-circle-check" className="mt-1 text-sky-300" />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="text-xs text-sky-200">Private portal · Authorised staff only · © Genius ITens</div>
        <Icon name="fa-earth-asia" className="absolute -right-24 -bottom-24 text-[22rem] text-white/5" />
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-bold text-slate-900">Sign in</h2>
          <p className="text-sm text-slate-500 mt-1">Use the account your administrator created for you.</p>
          <LoginForm />
          <p className="mt-6 text-xs text-slate-500 flex gap-2">
            <Icon name="fa-shield-halved" className="mt-0.5 text-sky-500" />
            After 5 wrong passwords the account is locked for 15 minutes. Forgot your password? Ask your administrator to reset it.
          </p>
        </div>
      </div>
    </div>
  );
}
