import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Icon } from "@/components/ui";
import { PlatformLoginForm } from "@/components/platform-forms";
import { consoleIsAvailable } from "@/lib/platform-db";
import { getPlatformSession } from "@/lib/platform-session";

export const metadata: Metadata = { title: "Genius ITens console" };

/**
 * The console's own front door. No company code, because a Super Admin belongs to no company.
 * Where the console is not configured this address does not exist at all.
 */
export default async function PlatformLoginPage() {
  if (!consoleIsAvailable()) redirect("/login");
  const s = await getPlatformSession();
  if (s) redirect(s.mustChangePassword ? "/platform/password" : "/platform");

  return (
    <div className="min-h-dvh grid lg:grid-cols-2 bg-gradient-to-br from-slate-50 via-white to-slate-100">
      <div className="hidden lg:flex flex-col justify-between p-12 bg-gradient-to-br from-slate-800 to-slate-950 text-white relative overflow-hidden">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-white/15 grid place-items-center text-xl"><Icon name="fa-shield-halved" /></div>
          <div className="text-xl font-bold">Genius ITens</div>
        </div>
        <div className="relative z-10">
          <h1 className="text-3xl font-bold leading-snug">Open an account.<br />Nothing more.</h1>
          <p className="mt-4 max-w-sm text-white/70 text-sm leading-relaxed">
            From here you create companies and the people who work in them, and you can block
            either. You cannot see a single voucher, balance or client of any company — the
            database will not allow it, whoever is signed in.
          </p>
        </div>
        <div className="text-xs text-white/50">A company&apos;s own desk is at a different address.</div>
        <Icon name="fa-building-lock" className="absolute -right-24 -bottom-24 text-[22rem] text-white/5" />
      </div>

      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-slate-800 text-white grid place-items-center"><Icon name="fa-shield-halved" /></div>
            <div className="font-bold text-slate-800">Genius ITens</div>
          </div>
          <h2 className="text-2xl font-bold text-slate-800">Super Admin</h2>
          <p className="mt-1 text-sm text-slate-500">Sign in to open and close company accounts.</p>
          <PlatformLoginForm />
        </div>
      </div>
    </div>
  );
}
