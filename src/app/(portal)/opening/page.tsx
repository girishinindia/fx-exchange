import type { Metadata } from "next";
import Link from "next/link";
import { Card, Icon, Note, PageHeader } from "@/components/ui";
import { getCompanyInfo } from "@/lib/company";
import { withTenant } from "@/lib/db";
import { todayISO } from "@/lib/format";
import { formatINR } from "@/lib/money";
import { requirePermission } from "@/lib/permissions";
import { tenantOf } from "@/lib/session";
import { VoucherForm, type AccountOpt, type PartyOpt } from "../vouchers/VoucherForm";
import { SimpleOpeningForm } from "./SimpleOpeningForm";

export const metadata: Metadata = { title: "Opening balance" };

export default async function OpeningPage({ searchParams }: PageProps<"/opening">) {
  const s = await requirePermission("company.manage");
  if (s.preview) return <Note tone="amber">Needs a real login.</Note>;
  const company = await getCompanyInfo(s);
  // the full voucher form is one link away, for a company that started with money owed to it
  // or by it; the first morning gets the simple question
  const advanced = (await searchParams).full === "1";
  const { accounts, parties, existing, currencies } = await withTenant(await tenantOf(s), async (tx) => {
    const currencies = await tx<{ code: string; name: string }[]>`
      select cc.currency_code as code, m.name
        from ex.company_currency cc join ex.currency_master m on m.code = cc.currency_code
       where cc.is_active order by cc.currency_code`;
    const accounts = await tx<AccountOpt[]>`
      select id, code, name, currency_code, is_control, party_kind from ex.account where is_active order by sort_order, code`;
    const parties = await tx<PartyOpt[]>`select id, full_name, is_client, is_depositor from ex.party where is_active order by full_name`;
    const [existing] = await tx<{ id: string; voucher_no: string; total_inr: string; voucher_date: string }[]>`
      select id, voucher_no, total_inr::text, to_char(voucher_date, 'YYYY-MM-DD') as voucher_date
        from ex.voucher where voucher_type = 'OPENING' and status = 'POSTED' limit 1`;
    return { accounts, parties, existing, currencies };
  });

  if (existing) {
    return (
      <>
        <PageHeader title="Opening balance" crumbs={["Ledger"]} subtitle="The books are already open." />
        <Note tone="emerald" icon="fa-circle-check">
          Opening balance <Link href={`/vouchers/${existing.id}`} className="underline font-medium">{existing.voucher_no}</Link> was posted for {formatINR(existing.total_inr)}.
          It is posted once and never again — any later correction is a journal voucher.
        </Note>
      </>
    );
  }

  if (!advanced) {
    return (
      <>
        <PageHeader
          title="What did the company start with?"
          crumbs={["Ledger", "Opening balance"]}
          subtitle="The cash and currency in hand on the day the company starts on FX Desk. Posted once, then locked."
        />
        <Card>
          <SimpleOpeningForm currencies={currencies} baseCurrency={company.baseCurrency}
            primaryCurrency={company.primaryCurrency} today={company.booksStartDate ?? todayISO()} />
        </Card>
        <p className="text-xs text-slate-500">
          <Icon name="fa-circle-info" className="mr-1" />
          Started with money already owed to you or by you — clients mid-way through a deal, depositors from before? Whoever keeps the books can use the{" "}
          <Link href="/opening?full=1" className="text-sky-700 underline">full opening voucher</Link> instead.
        </p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Opening balance — full voucher"
        crumbs={["Ledger", "Opening balance"]}
        subtitle={`Every account, any side. Book currency ${company.baseCurrency}, deal currency ${company.primaryCurrency}.`}
        actions={<Link href="/opening" className="text-sm text-sky-700 underline">Back to the simple form</Link>}
      />
      <Note icon="fa-lightbulb">
        Debit what you hold — cash and bank in each currency (with the rate it cost you), and rupees clients already owe you.
        Credit what you owe — depositors, currency still to be delivered to clients. The difference goes to <b>Opening Balance Equity</b>,
        which is the company&apos;s own capital.
      </Note>
      <Card>
        <VoucherForm accounts={accounts} parties={parties} baseCurrency={company.baseCurrency} today={company.booksStartDate ?? todayISO()}
          fixedType="OPENING" title="Post opening balance" />
      </Card>
      <p className="text-xs text-slate-500"><Icon name="fa-circle-info" className="mr-1" />Opening foreign currency needs the rate it was acquired at — that rate becomes its cost when it is sold.</p>
    </>
  );
}
