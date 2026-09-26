"use client";

import type { ActionState } from "@/lib/action";
import { ActionForm } from "@/components/ActionForm";
import { Field, Note } from "@/components/ui";

/** Small "enter a reason and confirm" form used for cancelling payments, expenses and reopening days. */
export function ReasonForm({
  action,
  id,
  warning,
  submit = "Confirm",
  label = "Reason",
  name = "reason",
  placeholder,
}: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  id: string;
  warning?: string;
  submit?: string;
  label?: string;
  name?: string;
  placeholder?: string;
}) {
  return (
    <ActionForm action={action} submit={submit} icon="fa-check" submitVariant="danger" closeOnSuccess>
      <input type="hidden" name="id" value={id} />
      {warning && <Note tone="amber" icon="fa-triangle-exclamation">{warning}</Note>}
      <Field label={label} name={name} required maxLength={300} placeholder={placeholder} autoFocus />
    </ActionForm>
  );
}
