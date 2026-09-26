import "server-only";
import { withTenant } from "@/lib/db";
import { cashAccountCode } from "@/lib/ledger";
import { assertPermission, hasPermission } from "@/lib/permissions";
import { tenantOf, type Session } from "@/lib/session";

/** Chart of accounts. Cash/bank accounts follow the company's currencies; the rest is free. */

export type AccountRow = {
  id: string; code: string; name: string; account_type: string; account_group: string; currency_code: string | null;
  is_control: boolean; party_kind: string | null; is_system: boolean; is_active: boolean; sort_order: number;
  balance_inr: string; balance_fx: string; note: string | null;
};

export type AccountInput = {
  id?: number;
  code?: string;
  name: string;
  accountType: "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";
  accountGroup: "CASH_BANK" | "EXPENSE" | "INCOME";
  currency?: string | null;
  note?: string | null;
  isActive?: boolean;
};

export async function listAccounts(s: Session, opts: { activeOnly?: boolean } = {}): Promise<AccountRow[]> {
  if (!(await hasPermission(s, "report.view")) && !(await hasPermission(s, "voucher.view"))) await assertPermission("account.manage", s);
  return withTenant(await tenantOf(s), (tx) =>
    tx<AccountRow[]>`
      select a.id, a.code, a.name, a.account_type, a.account_group, a.currency_code, a.is_control, a.party_kind,
             a.is_system, a.is_active, a.sort_order, a.note,
             coalesce(b.balance_inr, 0)::text as balance_inr, coalesce(b.balance_fx, 0)::text as balance_fx
        from ex.account a
        left join ex.v_account_balance b on b.account_id = a.id
       where (${opts.activeOnly ?? false} = false or a.is_active)
       order by a.sort_order, a.code`);
}

/** Add or edit an account. System accounts keep their code, type and currency. */
export async function saveAccount(s: Session, d: AccountInput): Promise<{ id: string; code: string }> {
  await assertPermission("account.manage", s);
  const currency = d.accountGroup === "CASH_BANK" ? (d.currency ?? "").toUpperCase() : null;
  if (d.accountGroup === "CASH_BANK" && !currency) throw new Error("Choose the currency this account holds");
  return withTenant(await tenantOf(s), async (tx) => {
    if (d.id) {
      const [row] = await tx<{ id: string; code: string }[]>`
        update ex.account set name = ${d.name}, note = ${d.note ?? null}, is_active = ${d.isActive ?? true}
         where id = ${d.id} returning id, code`;
      if (!row) throw new Error("Account not found");
      return { id: String(row.id), code: row.code };
    }
    if (currency) {
      const [cur] = await tx`select 1 from ex.company_currency where currency_code = ${currency} and is_active`;
      if (!cur) throw new Error(`${currency} is not one of the company's currencies`);
    }
    const code = (d.code || (currency ? cashAccountCode(currency) : d.name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 20))).toUpperCase();
    const [row] = await tx<{ id: string; code: string }[]>`
      insert into ex.account (code, name, account_type, account_group, currency_code, note, sort_order)
      values (${code}, ${d.name}, ${d.accountType}, ${d.accountGroup}, ${currency}, ${d.note ?? null},
              ${d.accountGroup === "CASH_BANK" ? 15 : 70})
      returning id, code`;
    return { id: String(row.id), code: row.code };
  });
}
