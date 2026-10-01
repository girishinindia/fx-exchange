"use client";

import { savePartyAction } from "@/app/actions/parties";
import { ActionForm } from "@/components/ActionForm";
import { Field, Note, SelectField } from "@/components/ui";
import type { PartyRow } from "@/server/services/parties";

/**
 * A name, a way to reach them, and nothing else. Every party is a depositor and a
 * client at once — the desk buys from whoever walks in and sells to whoever walks in,
 * and asking which one at the counter only slowed the entry down. City, address,
 * nationality, GSTIN and ID proof were dropped for the same reason; the columns are
 * still in the database for the companies that filled them in before.
 */
export function PartyForm({ party }: { party?: PartyRow }) {
  return (
    <ActionForm action={savePartyAction} submit={party ? "Save changes" : "Add party"}>
      {party && <input type="hidden" name="id" value={party.id} />}

      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Name" name="fullName" required defaultValue={party?.full_name} placeholder="Rajesh Traders" />
        <SelectField label="Type" name="partyForm" defaultValue={party?.party_form ?? "BUSINESS"}
          options={[{ value: "BUSINESS", label: "Business / firm" }, { value: "INDIVIDUAL", label: "Individual" }]} />
        <Field label="Mobile" name="phone" defaultValue={party?.phone ?? ""} placeholder="98765 43210" />
        <Field label="Email" name="email" type="email" defaultValue={party?.email ?? ""} />
        <Field label="Notes" name="notes" defaultValue={party?.notes ?? ""} className="md:col-span-2" />
      </div>

      <Note icon="fa-user-group">
        Saved as a <b>depositor and a client</b>, both — so this name can bring currency in and buy currency out
        without being set up twice.
      </Note>

      {party && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={party.is_active} className="h-4 w-4 accent-sky-600" />
          Active
        </label>
      )}
    </ActionForm>
  );
}
