import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, Icon, LinkButton, Note, PageHeader } from "@/components/ui";
import { getCompanyInfo } from "@/lib/company";
import { withTenant } from "@/lib/db";
import { todayISO } from "@/lib/format";
import { requirePermission } from "@/lib/permissions";
import { tenantOf } from "@/lib/session";
import { availableDeposits } from "@/server/services/deals";
import { DealForm, type ClientOpt } from "../DealForm";

export const metadata: Metadata = { title: "Book a deal" };

export default async function NewDealPage() {
  const s = await requirePermission("deal.manage");
  if (s.preview) return <Note tone="amber">Needs a real login.</Note>;
  const company = await getCompanyInfo(s);

  const deposits = await availableDeposits(s);
  const { clients, currencies } = await withTenant(await tenantOf(s), async (tx) => {
    const clients = await tx<ClientOpt[]>`
      select p.id, p.full_name, p.party_code,
             coalesce((select receivable_inr from ex.v_client_summary c where c.party_id = p.id), 0)::text as receivable_inr
        from ex.party p where p.is_active and p.is_client order by p.full_name`;
    const currencies = await tx<{ code: string }[]>`
      select trim(currency_code) as code from ex.company_currency
       where is_active and trim(currency_code) not in (${company.baseCurrency}, ${company.primaryCurrency})
       order by display_order, currency_code`;
    return { clients, currencies: currencies.map((c) => c.code) };
  });

  if (clients.length === 0 || currencies.length === 0) {
    return (
      <>
        <PageHeader title="Book a deal" crumbs={["Daily work", "Deals"]} />
        <EmptyState
          icon={clients.length === 0 ? "fa-user-plus" : "fa-coins"}
          title={clients.length === 0 ? "No client yet" : "No currency to deal in"}
          text={clients.length === 0
            ? "A deal needs someone to bill. Add the party first and tick “client”."
            : `Add the currencies clients ask for — anything other than ${company.baseCurrency} and ${company.primaryCurrency}.`}
          action={clients.length === 0
            ? <LinkButton href="/parties/new" icon="fa-plus">Add a client</LinkButton>
            : <LinkButton href="/admin/currencies" icon="fa-plus">Currencies</LinkButton>}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Book a deal"
        crumbs={["Daily work", "Deals"]}
        subtitle={`Give a client the currency they asked for, out of the ${company.primaryCurrency} depositors brought in.`}
        actions={<LinkButton href="/deals" variant="ghost" icon="fa-arrow-left">All deals</LinkButton>}
      />
      {deposits.length === 0 && (
        <Note tone="amber" icon="fa-triangle-exclamation">
          Every deposit has been spent. <Link href="/deposits/new" className="underline font-medium">Record a deposit</Link> before booking this deal.
        </Note>
      )}
      <Card>
        <DealForm clients={clients} deposits={deposits} currencies={currencies}
          primaryCurrency={company.primaryCurrency} baseCurrency={company.baseCurrency} today={todayISO()} />
      </Card>
      <p className="text-xs text-slate-500">
        <Icon name="fa-circle-info" className="mr-1" />
        The client now owes rupees and the company owes them currency — two separate debts, tracked apart.
        The currency is handed over on the payouts screen, the rupees arrive on the receipts screen.
      </p>
    </>
  );
}
