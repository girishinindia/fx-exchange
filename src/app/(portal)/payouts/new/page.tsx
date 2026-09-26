import type { Metadata } from "next";
import { Card, EmptyState, Icon, LinkButton, Note, PageHeader } from "@/components/ui";
import { withTenant } from "@/lib/db";
import { todayISO } from "@/lib/format";
import { requirePermission } from "@/lib/permissions";
import { tenantOf } from "@/lib/session";
import { currencyDue } from "@/server/services/deals";
import { PayoutForm, type CashRow } from "../PayoutForm";

export const metadata: Metadata = { title: "Hand currency over" };

export default async function NewPayoutPage({ searchParams }: PageProps<"/payouts/new">) {
  const s = await requirePermission("voucher.create");
  if (s.preview) return <Note tone="amber">Needs a real login.</Note>;
  const sp = await searchParams;
  const preselect = typeof sp.due === "string" && /^\d+:[A-Z]{3}$/.test(sp.due) ? sp.due : undefined;

  const due = await currencyDue(s);
  const cash = await withTenant(await tenantOf(s), (tx) =>
    tx<CashRow[]>`
      select a.code, a.name, a.currency_code, coalesce(b.balance_fx, 0)::text as balance_fx
        from ex.account a
        left join ex.v_account_balance b on b.account_id = a.id
       where a.is_active and a.account_group = 'CASH_BANK'
       order by a.sort_order, a.code`);

  return (
    <>
      <PageHeader
        title="Hand currency over"
        crumbs={["Daily work", "Currency payouts"]}
        subtitle="Giving a client the currency a deal promised them."
        actions={<LinkButton href="/payouts" variant="ghost" icon="fa-arrow-left">All payouts</LinkButton>}
      />
      {due.length === 0 ? (
        <EmptyState icon="fa-circle-check" title="Nothing to hand over"
          text="Every client has already been given the currency they were promised."
          action={<LinkButton href="/deals" icon="fa-right-left">Deals</LinkButton>} />
      ) : (
        <Card>
          <PayoutForm due={due} cash={cash} today={todayISO()} preselect={preselect} />
        </Card>
      )}
      <p className="text-xs text-slate-500">
        <Icon name="fa-circle-info" className="mr-1" />
        The books refuse more than the client is owed, and more than the company actually holds in that currency.
        The rupees the client owes are a separate debt — they arrive on the receipts screen.
      </p>
    </>
  );
}
