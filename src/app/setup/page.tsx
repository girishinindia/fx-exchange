import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, Icon, Note } from "@/components/ui";
import { CompanySetupForm } from "@/components/setup-forms";
import { withTenant } from "@/lib/db";
import { signOut } from "@/app/actions/auth";
import { requireSession, tenantOf } from "@/lib/session";

export const metadata: Metadata = { title: "Set your company up" };
export const dynamic = "force-dynamic";

/**
 * The company's own first act. Only an Administrator can do it, and nothing else in the portal
 * opens until it is done — there is no sensible desk screen before the desk has a currency.
 */
export default async function CompanySetupPage() {
  const s = await requireSession({ stage: "company" });
  if (s.companySetUp) redirect("/dashboard");

  const ctx = await tenantOf(s);
  const [co] = await withTenant(ctx, (tx) =>
    tx<{ code: string; legal_name: string; base_currency_code: string }[]>`
      select code, legal_name, trim(base_currency_code) as base_currency_code from ex.company where id = ${s.companyId}`);

  if (s.userType !== "ADMIN") {
    return (
      <div className="min-h-dvh grid place-items-center bg-gradient-to-br from-sky-50 via-white to-sky-100 p-8">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-amber-100 text-amber-700 grid place-items-center text-xl">
            <Icon name="fa-hourglass-half" />
          </div>
          <h1 className="mt-4 text-2xl font-bold text-slate-800">Nearly there</h1>
          <p className="mt-2 text-sm text-slate-600">
            {co?.code} has not been set up yet. One of your Administrators needs to sign in and
            choose the currency the desk deals in. Once they have, everything opens for you too.
          </p>
          <form action={signOut} className="mt-6">
            <button className="text-sm font-medium text-sky-700 hover:underline" type="submit">Sign out</button>
          </form>
        </div>
      </div>
    );
  }

  const currencies = await withTenant(ctx, (tx) =>
    tx<{ code: string; name: string }[]>`
      select code, name from ex.currency_master
       where is_active and code <> ${co?.base_currency_code ?? "INR"} order by (code <> 'USD'), code`);

  return (
    <div className="min-h-dvh bg-gradient-to-br from-sky-50 via-white to-sky-100 py-10 px-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-sky-600 text-white grid place-items-center"><Icon name="fa-coins" /></div>
          <div className="font-bold text-slate-800">FX Desk</div>
        </div>
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Set {co?.code} up</h1>
          <p className="mt-2 text-slate-600">
            Genius ITens opened the account; the desk is yours to set up. This takes two minutes
            and happens once.
          </p>
        </div>
        <Note tone="sky" icon="fa-circle-info">
          Nothing else opens until this is done, because almost every screen depends on knowing
          what currency you deal in.
        </Note>
        <Card>
          <CompanySetupForm
            code={co?.code ?? ""} legalName={co?.legal_name ?? ""}
            baseCurrency={co?.base_currency_code ?? "INR"}
            currencies={currencies.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))}
          />
        </Card>
      </div>
    </div>
  );
}
