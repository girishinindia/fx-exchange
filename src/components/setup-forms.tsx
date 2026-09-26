"use client";

import { useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import { Field, Note, SelectField } from "@/components/ui";
import { SubmitButton } from "@/components/forms";
import { completeCompanySetupAction, completeProfileAction, type SetupState } from "@/app/actions/setup";

function Message({ state }: { state: SetupState }) {
  if (state.error) return <Note tone="rose" icon="fa-circle-exclamation">{state.error}</Note>;
  return null;
}

export function ProfileSetupForm({ name, phone }: { name: string; phone: string | null }) {
  const [state, onSubmit, pending] = useFormAction<SetupState>(completeProfileAction, {});
  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <Message state={state} />
      <Field label="Your full name" name="fullName" required autoFocus defaultValue={name}
             hint="This goes on every voucher you post, so put your real name." />
      <Field label="Mobile" name="phone" inputMode="tel" defaultValue={phone ?? ""}
             hint="So the desk can reach you. You can leave it blank." />
      <SubmitButton pending={pending} icon="fa-check" className="w-full">
        {pending ? "Saving…" : "That's me — continue"}
      </SubmitButton>
    </form>
  );
}

export function CompanySetupForm({
  code, legalName, baseCurrency, currencies,
}: {
  code: string; legalName: string; baseCurrency: string;
  currencies: Array<{ value: string; label: string }>;
}) {
  const [state, onSubmit, pending] = useFormAction<SetupState>(completeCompanySetupAction, {});
  const [currency, setCurrency] = useState("USD");

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Message state={state} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Who you are</h2>
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="Registered name" name="legalName" required autoFocus defaultValue={legalName}
                 hint="Exactly as it appears on your licence." />
          <Field label="Short name" name="displayName" placeholder={legalName}
                 hint="What you would like to see at the top of the screen. Optional." />
        </div>
        <div className="grid md:grid-cols-3 gap-3">
          <Field label="Phone" name="phone" inputMode="tel" />
          <Field label="Email" name="email" type="email" />
          <Field label="Licence no." name="licenseNo" />
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="GSTIN" name="gstin" className="[&_input]:uppercase" />
          <Field label="PAN" name="pan" className="[&_input]:uppercase" />
        </div>
        <Field label="Address" name="address" />
        <div className="grid md:grid-cols-3 gap-3">
          <Field label="City" name="city" />
          <Field label="State" name="state" />
          <Field label="PIN code" name="pincode" inputMode="numeric" />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">What you deal in</h2>
        <div className="grid md:grid-cols-2 gap-3">
          <SelectField label="The currency depositors bring you" name="primaryCurrency" required
                       value={currency} onChange={(e) => setCurrency(e.target.value)} options={currencies}
                       hint="Nearly every desk deals in dollars." />
          <div className="rounded-xl border border-sky-100 bg-sky-50/60 px-4 py-3">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Your books are kept in</div>
            <div className="mt-1 text-2xl font-semibold text-sky-800">{baseCurrency}</div>
            <div className="text-xs text-slate-500">Every report totals in {baseCurrency}.</div>
          </div>
        </div>
        <Note tone="amber" icon="fa-lock">
          <b>{currency} cannot be changed afterwards.</b> Every deposit this desk ever takes will be
          in it, and every deal will be priced from it. If {currency} is not what your depositors
          hand you, stop and telephone Genius ITens before going on.
        </Note>
      </section>

      <SubmitButton pending={pending} icon="fa-flag-checkered">
        {pending ? "Setting up…" : `Set ${code} up, dealing in ${currency}`}
      </SubmitButton>
    </form>
  );
}
