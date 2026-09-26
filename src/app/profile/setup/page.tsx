import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Icon } from "@/components/ui";
import { ProfileSetupForm } from "@/components/setup-forms";
import { withTenant } from "@/lib/db";
import { requireSession, tenantOf } from "@/lib/session";

export const metadata: Metadata = { title: "Tell us who you are" };
export const dynamic = "force-dynamic";

/** Every person's first screen. Their name goes on every voucher they post — it should be theirs. */
export default async function ProfileSetupPage() {
  const s = await requireSession({ stage: "profile" });
  if (s.profileCompleted) redirect(s.companySetUp ? "/dashboard" : "/setup");

  const [me] = await withTenant(await tenantOf(s), (tx) =>
    tx<{ full_name: string; phone: string | null }[]>`select full_name, phone from ex.app_user where id = ${s.userId}`);

  return (
    <div className="min-h-dvh grid place-items-center bg-gradient-to-br from-sky-50 via-white to-sky-100 p-8">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-sky-600 text-white grid place-items-center"><Icon name="fa-coins" /></div>
          <div className="font-bold text-slate-800">FX Desk · {s.companyCode}</div>
        </div>
        <h1 className="text-2xl font-bold text-slate-800">Before you start</h1>
        <p className="mt-1 text-sm text-slate-500">
          You are signed in as <b>{s.email}</b>. Check your name is right — it will appear on
          everything you enter, and the auditor will read it.
        </p>
        <ProfileSetupForm name={me?.full_name ?? s.userName} phone={me?.phone ?? null} />
      </div>
    </div>
  );
}
