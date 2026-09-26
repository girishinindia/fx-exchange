import type { Metadata } from "next";
import { Card, EmptyState, Icon, LinkButton, Note, PageHeader } from "@/components/ui";
import { getCompanyInfo } from "@/lib/company";
import { withTenant } from "@/lib/db";
import { todayISO } from "@/lib/format";
import { requirePermission } from "@/lib/permissions";
import { tenantOf } from "@/lib/session";
import type { DepositorOpt } from "../../deposits/DepositForm";
import { SettlementForm } from "../SettlementForm";

export const metadata: Metadata = { title: "Pay a depositor" };

export default async function NewSettlementPage({ searchParams }: PageProps<"/settlements/new">) {
  const s = await requirePermission("voucher.create");
  if (s.preview) return <Note tone="amber">Needs a real login.</Note>;
  const company = await getCompanyInfo(s);
  const sp = await searchParams;
  const preselect = typeof sp.depositor === "string" && /^\d+$/.test(sp.depositor) ? sp.depositor : undefined;

  const { depositors, cashAccounts } = await withTenant(await tenantOf(s), async (tx) => {
    const depositors = await tx<DepositorOpt[]>`
      select p.id, p.full_name, p.party_code,
             coalesce(v.outstanding_inr, 0)::text as outstanding_inr,
             coalesce(v.outstanding_fx, 0)::text  as outstanding_fx,
             v.outstanding_currency
        from ex.party p
        left join ex.v_depositor_summary v on v.party_id = p.id
       where p.is_active and p.is_depositor
       order by p.full_name`;
    const cashAccounts = await tx<{ code: string; name: string; balance_inr: string }[]>`
      select a.code, a.name, coalesce(b.balance_inr, 0)::text as balance_inr
        from ex.account a
        left join ex.v_account_balance b on b.account_id = a.id
       where a.is_active and a.account_group = 'CASH_BANK' and trim(a.currency_code) = ${company.baseCurrency}
       order by a.sort_order, a.code`;
    return { depositors, cashAccounts };
  });

  const owing = depositors.filter((d) => Number(d.outstanding_fx) > 0);
  const rupeesInHand = cashAccounts.reduce((a, c) => a + Number(c.balance_inr), 0).toFixed(2);

  return (
    <>
      <PageHeader
        title="Pay a depositor"
        crumbs={["Daily work", "Settlements"]}
        subtitle={`${company.baseCurrency} out of the company's own account, against the ${company.primaryCurrency} a depositor is owed — at the rate you agree today.`}
        actions={<LinkButton href="/settlements" variant="ghost" icon="fa-arrow-left">All settlements</LinkButton>}
      />
      {owing.length === 0 ? (
        <EmptyState icon="fa-circle-check" title="Nothing to settle"
          text="Every depositor has been paid what the books say they are owed."
          action={<LinkButton href="/deposits" icon="fa-down-long">Deposits</LinkButton>} />
      ) : (
        <Card>
          <SettlementForm depositors={depositors} cashAccounts={cashAccounts} baseCurrency={company.baseCurrency}
            today={todayISO()} rupeesInHand={rupeesInHand} preselect={preselect} />
        </Card>
      )}
      <p className="text-xs text-slate-500">
        <Icon name="fa-circle-info" className="mr-1" />
        The books refuse a settlement larger than the depositor is owed, and a payment larger than the rupees the company actually holds.
        The rate is never carried over from the deposit — what the depositor is owed is {company.primaryCurrency}, and what that costs in rupees is
        whatever you agree on the day you pay it.
      </p>
    </>
  );
}
