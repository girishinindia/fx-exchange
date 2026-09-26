import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, Icon, LinkButton, Note, PageHeader } from "@/components/ui";
import { getCompanyInfo } from "@/lib/company";
import { withTenant } from "@/lib/db";
import { todayISO } from "@/lib/format";
import { requirePermission } from "@/lib/permissions";
import { tenantOf } from "@/lib/session";
import { DepositForm, type DepositorOpt } from "../DepositForm";

export const metadata: Metadata = { title: "Record a deposit" };

export default async function NewDepositPage() {
  const s = await requirePermission("voucher.create");
  if (s.preview) return <Note tone="amber">Needs a real login.</Note>;
  const company = await getCompanyInfo(s);

  const { depositors, currencies } = await withTenant(await tenantOf(s), async (tx) => {
    const depositors = await tx<DepositorOpt[]>`
      select p.id, p.full_name, p.party_code,
             coalesce(v.outstanding_inr, 0)::text as outstanding_inr,
             coalesce(v.outstanding_fx, 0)::text  as outstanding_fx,
             v.outstanding_currency
        from ex.party p
        left join ex.v_depositor_summary v on v.party_id = p.id
       where p.is_active and p.is_depositor
       order by p.full_name`;
    // a depositor may hand over anything the company deals in — the dealing currency first,
    // because that is what nearly every deposit is
    const currencies = await tx<{ code: string; name: string }[]>`
      select cc.currency_code as code, m.name
        from ex.company_currency cc
        join ex.currency_master m on m.code = cc.currency_code
        join ex.company co on co.id = ex.current_company_id()
       where cc.is_active and cc.currency_code <> co.base_currency_code
       order by (cc.currency_code = co.primary_currency_code) desc, cc.display_order, cc.currency_code`;
    return { depositors, currencies };
  });

  return (
    <>
      <PageHeader
        title="Record a deposit"
        crumbs={["Daily work", "Deposits"]}
        subtitle={`Currency handed to the company. The depositor is owed ${company.primaryCurrency} back — what that costs in rupees is agreed on the day it is paid.`}
        actions={<LinkButton href="/deposits" variant="ghost" icon="fa-arrow-left">All deposits</LinkButton>}
      />
      {depositors.length === 0 ? (
        <EmptyState
          icon="fa-user-plus"
          title="No depositor yet"
          text="A deposit needs someone to credit it to. Add the party first and tick “depositor”."
          action={<LinkButton href="/parties/new" icon="fa-plus">Add a depositor</LinkButton>}
        />
      ) : (
        <Card>
          <DepositForm depositors={depositors} currencies={currencies} primaryCurrency={company.primaryCurrency}
            baseCurrency={company.baseCurrency} today={todayISO()} />
        </Card>
      )}
      <p className="text-xs text-slate-500">
        <Icon name="fa-circle-info" className="mr-1" />
        The rate belongs to this deposit alone — it is what the {company.primaryCurrency} cost, and it is what the margin is measured
        against when this money is dealt out. Later payments to the depositor are recorded on the{" "}
        <Link href="/settlements" className="underline">settlements</Link> screen.
      </p>
    </>
  );
}
