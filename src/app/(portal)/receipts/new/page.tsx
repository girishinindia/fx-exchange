import type { Metadata } from "next";
import { Card, EmptyState, Icon, LinkButton, Note, PageHeader } from "@/components/ui";
import { getCompanyInfo } from "@/lib/company";
import { withTenant } from "@/lib/db";
import { todayISO } from "@/lib/format";
import { requirePermission } from "@/lib/permissions";
import { tenantOf } from "@/lib/session";
import { clientPositions } from "@/server/services/clients";
import { ReceiptForm } from "../ReceiptForm";

export const metadata: Metadata = { title: "Record a receipt" };

export default async function NewReceiptPage({ searchParams }: PageProps<"/receipts/new">) {
  const s = await requirePermission("voucher.create");
  if (s.preview) return <Note tone="amber">Needs a real login.</Note>;
  const company = await getCompanyInfo(s);
  const sp = await searchParams;
  const preselect = typeof sp.client === "string" && /^\d+$/.test(sp.client) ? sp.client : undefined;

  const positions = await clientPositions(s);
  const cashAccounts = await withTenant(await tenantOf(s), (tx) =>
    tx<{ code: string; name: string; balance_inr: string }[]>`
      select a.code, a.name, coalesce(b.balance_inr, 0)::text as balance_inr
        from ex.account a
        left join ex.v_account_balance b on b.account_id = a.id
       where a.is_active and a.account_group = 'CASH_BANK' and trim(a.currency_code) = ${company.baseCurrency}
       order by a.sort_order, a.code`);

  const clients = positions.map((p) => ({
    party_id: p.party_id, full_name: p.full_name, party_code: p.party_code, receivable_inr: p.receivable_inr,
  }));

  return (
    <>
      <PageHeader
        title="Record a receipt"
        crumbs={["Daily work", "Receipts"]}
        subtitle={`${company.baseCurrency} arriving from a client, against what a deal billed them.`}
        actions={<LinkButton href="/receipts" variant="ghost" icon="fa-arrow-left">All receipts</LinkButton>}
      />
      {clients.length === 0 ? (
        <EmptyState icon="fa-user-plus" title="No client yet"
          text="A receipt needs a client to credit it to."
          action={<LinkButton href="/parties/new" icon="fa-plus">Add a client</LinkButton>} />
      ) : (
        <Card>
          <ReceiptForm clients={clients} cashAccounts={cashAccounts} baseCurrency={company.baseCurrency}
            today={todayISO()} preselect={preselect} />
        </Card>
      )}
      <p className="text-xs text-slate-500">
        <Icon name="fa-circle-info" className="mr-1" />
        These rupees are what the depositors are settled with. Once they are in, the cycle closes on the settlements screen.
      </p>
    </>
  );
}
