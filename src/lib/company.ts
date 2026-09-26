import "server-only";
import { withTenant } from "@/lib/db";
import { tenantOf, type Session } from "@/lib/session";

export type CompanyInfo = {
  name: string;
  code: string;
  /** Book / reporting currency — every ledger balances in this (INR). */
  baseCurrency: string;
  /** Currency depositors bring in (USD). Set once, then locked. */
  primaryCurrency: string;
  primaryLocked: boolean;
  booksStartDate: string | null;
  fiscalYearStartMonth: number;
};

export async function getCompanyInfo(s: Session): Promise<CompanyInfo> {
  if (s.preview) {
    return { name: s.companyName, code: s.companyCode, baseCurrency: "INR", primaryCurrency: "USD", primaryLocked: false, booksStartDate: null, fiscalYearStartMonth: 4 };
  }
  const rows = await withTenant(await tenantOf(s), (tx) =>
    tx<{ name: string; code: string; base_currency_code: string; primary_currency_code: string; primary_currency_locked: boolean; books_start_date: string | null; fiscal_year_start_month: number }[]>`
      select coalesce(display_name, legal_name) as name, code, base_currency_code, primary_currency_code,
             primary_currency_locked, to_char(books_start_date, 'YYYY-MM-DD') as books_start_date, fiscal_year_start_month
        from ex.company`,
  );
  const r = rows[0];
  if (!r) throw new Error("Company not found for session");
  return {
    name: r.name,
    code: r.code,
    baseCurrency: r.base_currency_code.trim(),
    primaryCurrency: r.primary_currency_code.trim(),
    primaryLocked: r.primary_currency_locked,
    booksStartDate: r.books_start_date,
    fiscalYearStartMonth: r.fiscal_year_start_month,
  };
}
