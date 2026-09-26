"use client";

import { useState } from "react";
import { savePartyAction } from "@/app/actions/parties";
import { ActionForm } from "@/components/ActionForm";
import { Field, SelectField } from "@/components/ui";
import type { PartyRow } from "@/server/services/parties";

const ID_TYPES = [
  { value: "", label: "—" }, { value: "PASSPORT", label: "Passport" }, { value: "AADHAAR", label: "Aadhaar" },
  { value: "PAN", label: "PAN" }, { value: "DRIVING_LICENSE", label: "Driving licence" }, { value: "VOTER_ID", label: "Voter ID" },
  { value: "OTHER", label: "Other" },
];

export function PartyForm({ party }: { party?: PartyRow }) {
  const [isDepositor, setDepositor] = useState(party?.is_depositor ?? false);
  const [isClient, setClient] = useState(party?.is_client ?? true);
  const box = "h-4 w-4 accent-sky-600";
  return (
    <ActionForm action={savePartyAction} submit={party ? "Save changes" : "Add party"}>
      {party && <input type="hidden" name="id" value={party.id} />}
      <fieldset className="rounded-xl border border-sky-100 p-4">
        <legend className="px-2 text-sm font-medium text-slate-700">This party is</legend>
        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="isDepositor" defaultChecked={isDepositor} onChange={(e) => setDepositor(e.target.checked)} className={box} />
            <span><b>Depositor</b> — brings in currency, is owed rupees</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="isClient" defaultChecked={isClient} onChange={(e) => setClient(e.target.checked)} className={box} />
            <span><b>Client</b> — buys currency, pays rupees</span>
          </label>
        </div>
        {!isDepositor && !isClient && <p className="mt-2 text-xs text-rose-600">Tick at least one.</p>}
      </fieldset>

      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Name" name="fullName" required defaultValue={party?.full_name} placeholder="Rajesh Traders" />
        <SelectField label="Type" name="partyForm" defaultValue={party?.party_form ?? "BUSINESS"}
          options={[{ value: "BUSINESS", label: "Business / firm" }, { value: "INDIVIDUAL", label: "Individual" }]} />
        <Field label="Mobile" name="phone" defaultValue={party?.phone ?? ""} placeholder="98765 43210" />
        <Field label="Email" name="email" type="email" defaultValue={party?.email ?? ""} />
        <Field label="City" name="city" defaultValue={party?.city ?? ""} />
        <Field label="Country / nationality" name="nationality" defaultValue={party?.nationality ?? ""} />
        <Field label="Address" name="address" defaultValue={party?.address ?? ""} className="md:col-span-2" />
        <SelectField label="ID proof" name="idProofType" defaultValue={party?.id_proof_type ?? ""} options={ID_TYPES} />
        <Field label="ID number" name="idProofNumber" defaultValue={party?.id_proof_number ?? ""} />
        <Field label="GSTIN" name="gstin" defaultValue={party?.gstin ?? ""} className="[&_input]:uppercase" />
        <Field label="Notes" name="notes" defaultValue={party?.notes ?? ""} />
      </div>
      {party && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={party.is_active} className={box} />
          Active
        </label>
      )}
    </ActionForm>
  );
}
