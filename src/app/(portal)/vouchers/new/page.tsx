import type { Metadata } from "next";
import { Card, Note, PageHeader } from "@/components/ui";
import { withTenant } from "@/lib/db";
import { todayISO } from "@/lib/format";
import { getCompanyInfo } from "@/lib/company";
import { requirePermission } from "@/lib/permissions";
import { tenantOf } from "@/lib/session";
import { VoucherForm, type AccountOpt, type PartyOpt } from "../VoucherForm";

export const metadata: Metadata = { title: "New voucher" };

export default async function NewVoucherPage() {
  const s = await requirePermission("voucher.create");
  if (s.preview) return <Note tone="amber">Needs a real login.</Note>;
  const company = await getCompanyInfo(s);
  const { accounts, parties } = await withTenant(await tenantOf(s), async (tx) => {
    const accounts = await tx<AccountOpt[]>`
      select id, code, name, currency_code, is_control, party_kind from ex.account where is_active order by sort_order, code`;
    const parties = await tx<PartyOpt[]>`
      select id, full_name, is_client, is_depositor from ex.party where is_active order by full_name`;
    return { accounts, parties };
  });

  return (
    <>
      <PageHeader
        title="New voucher"
        crumbs={["Ledger", "Vouchers"]}
        subtitle="Type the debits and credits. Deposits, deals, payouts, receipts and settlements get their own simple screens in the next phases."
      />
      <Card>
        <VoucherForm accounts={accounts} parties={parties} baseCurrency={company.baseCurrency} today={todayISO()} />
      </Card>
    </>
  );
}
