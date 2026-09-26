"use client";

import { useState } from "react";
import { saveAccountAction } from "@/app/actions/accounts";
import { ActionForm } from "@/components/ActionForm";
import { Field, Note, SelectField } from "@/components/ui";
import type { AccountRow } from "@/server/services/accounts";

export function AccountForm({ currencies, account }: { currencies: string[]; account?: AccountRow }) {
  const [group, setGroup] = useState<string>(account?.account_group ?? "EXPENSE");
  const editing = !!account;
  return (
    <ActionForm action={saveAccountAction} submit={editing ? "Save changes" : "Add account"} closeOnSuccess>
      {editing && <input type="hidden" name="id" value={account.id} />}
      {editing ? (
        <>
          <input type="hidden" name="accountType" value={account.account_type} />
          <input type="hidden" name="accountGroup" value={account.account_group} />
          <Note tone="slate" icon="fa-lock">The code, type and currency of an account never change — they are part of every posting made with it.</Note>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Kind of account" name="accountGroup" value={group} onChange={(e) => setGroup(e.target.value)}
            options={[
              { value: "CASH_BANK", label: "Cash / bank (holds one currency)" },
              { value: "EXPENSE", label: "Expense head" },
              { value: "INCOME", label: "Income head" },
            ]} />
          {group === "CASH_BANK" ? (
            <SelectField label="Currency" name="currency" required options={currencies.map((c) => ({ value: c, label: c }))} />
          ) : (
            <input type="hidden" name="currency" value="" />
          )}
          <input type="hidden" name="accountType" value={group === "CASH_BANK" ? "ASSET" : group === "INCOME" ? "INCOME" : "EXPENSE"} />
        </div>
      )}
      <Field label="Account name" name="name" required defaultValue={account?.name} placeholder={group === "CASH_BANK" ? "HDFC current account — USD" : "Courier charges"} />
      <Field label="Note" name="note" defaultValue={account?.note ?? ""} hint="Shown only in the chart of accounts." />
      {editing && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={account.is_active} className="h-4 w-4 accent-sky-600" />
          Active
        </label>
      )}
    </ActionForm>
  );
}
