import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, Icon, LinkButton, Note } from "@/components/ui";
import { getCompanyInfo } from "@/lib/company";
import { withTenant } from "@/lib/db";
import { fmtDate, todayISO } from "@/lib/format";
import { formatINR, formatQty } from "@/lib/money";
import { getPermissions } from "@/lib/permissions";
import { requireSession, tenantOf } from "@/lib/session";
import { todo } from "@/server/services/counter";
import { availableDeposits } from "@/server/services/deals";
import { listVouchers } from "@/server/services/ledger";
import { EntryForm, type CashOpt, type PartyOpt } from "./EntryForm";
import { TodoList } from "../home/TodoList";

export const metadata: Metadata = { title: "Entry" };

const TYPE_WORD: Record<string, string> = { DEPOSIT: "Bought", DEAL: "Sold", PAYOUT: "Handed over", RECEIPT: "Received ₹", SETTLEMENT: "Paid", REVERSAL: "Reversed", EXPENSE: "Expense", JOURNAL: "Journal", OPENING: "Opening", REVALUATION: "Revalued" };

/**
 * The counter. Left: the one form — Buy | Sell, five fields, "settled now?" — that clears
 * and refocuses after every save. Right: what was posted today and what is still open,
 * so a desk person never needs another page.
 */
export default async function EntryPage({ searchParams }: PageProps<"/entry">) {
  const s = await requireSession();
  if (s.preview) return <Note tone="amber">Needs a real login.</Note>;
  const perms = await getPermissions(s);
  const company = await getCompanyInfo(s);
  const sp = await searchParams;
  const mode = sp.mode === "buy" ? "buy" : "sell";
  const today = todayISO();

  const [parties, currencies, cash] = await withTenant(await tenantOf(s), async (tx) => {
    const parties = await tx<PartyOpt[]>`
      select p.id::text as id, p.full_name, p.party_code, p.phone, p.is_client, p.is_depositor,
             coalesce((select sum(b.balance_inr) from ex.v_party_balance b where b.party_id = p.id and b.account_group = 'RECEIVABLE'), 0)::text as receivable_inr,
             coalesce((select sum(d.fx_due) from ex.v_depositor_due d where d.party_id = p.id), 0)::text as owed_fx,
             coalesce((select sum(d.inr_value) from ex.v_depositor_due d where d.party_id = p.id), 0)::text as owed_inr
        from ex.party p where p.is_active order by p.full_name`;
    const currencies = await tx<{ code: string }[]>`
      select trim(currency_code) as code from ex.company_currency where is_active order by display_order, currency_code`;
    const cash = await tx<CashOpt[]>`
      select a.code, a.name, trim(a.currency_code) as currency_code from ex.account a
       where a.is_active and a.account_group = 'CASH_BANK' order by a.sort_order, a.code`;
    return [parties, currencies.map((c) => c.code), cash] as const;
  });
  const deposits = perms.has("voucher.view") ? await availableDeposits(s) : [];
  const [recent, open] = await Promise.all([
    perms.has("voucher.view") ? listVouchers(s, { from: today, to: today, limit: 12 }) : Promise.resolve({ rows: [], total: 0 }),
    perms.has("report.view") ? todo(s) : Promise.resolve(null),
  ]);

  const sellCurrencies = currencies.filter((c) => c !== company.baseCurrency && c !== company.primaryCurrency);
  const buyCurrencies = [company.primaryCurrency, ...currencies.filter((c) => c !== company.baseCurrency && c !== company.primaryCurrency)];

  return (
    <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
      <Card>
        <EntryForm mode={mode} parties={parties} currencies={sellCurrencies} buyCurrencies={buyCurrencies}
          deposits={deposits.map((d) => ({ deposit_id: String(d.deposit_id), voucher_no: d.voucher_no, depositor_name: d.depositor_name, manual_rate: d.manual_rate, fx_unallocated: d.fx_unallocated }))}
          cash={cash} base={company.baseCurrency} primary={company.primaryCurrency} today={today}
          canSell={perms.has("deal.manage")} canCreate={perms.has("voucher.create")} />
      </Card>

      <div className="space-y-4">
        <Card title={`Today · ${fmtDate(today)}`} icon="fa-clock" padded={false}
              actions={<Badge tone="slate">{recent.total} {recent.total === 1 ? "entry" : "entries"}</Badge>}>
          {recent.rows.length === 0 ? (
            <p className="px-4 py-5 text-sm text-slate-500">Nothing posted yet today. The first entry appears here the moment it is saved.</p>
          ) : (
            <ul className="divide-y divide-sky-50">
              {recent.rows.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <Link href={`/vouchers/${v.id}`} className="font-semibold text-slate-800 hover:text-sky-700">
                      {TYPE_WORD[v.voucher_type] ?? v.voucher_type}{v.party_name ? ` · ${v.party_name}` : ""}
                    </Link>
                    <div className="truncate text-xs text-slate-500">{v.voucher_no}{v.reference_no ? ` · ${v.reference_no}` : ""}{v.status === "REVERSED" ? " · reversed" : ""}</div>
                  </div>
                  <div className="tabular-nums text-slate-700">{formatINR(v.total_inr, { decimals: 0 })}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {open && (
          <Card title="Still open" icon="fa-list-check" padded={false}
                actions={<LinkButton href="/home" variant="ghost">All</LinkButton>}>
            <TodoList items={open.items.slice(0, 8)} compact />
            {open.items.length === 0 && <p className="px-4 py-5 text-sm text-slate-500"><Icon name="fa-circle-check" className="mr-1 text-emerald-600" />Nothing waiting — every client has their currency and has paid, every depositor is settled.</p>}
          </Card>
        )}

        <p className="px-1 text-xs text-slate-500">
          Undo? Open the entry and press <b>Reverse</b>, with a reason — as always. A sale settled on the spot is three vouchers (sale, hand-over, receipt), reversed newest first.
          {deposits.length > 0 && <> Unspent {company.primaryCurrency}: <b>{formatQty(deposits.reduce((a, d) => a + Number(d.fx_unallocated), 0))}</b>.</>}
        </p>
      </div>
    </div>
  );
}
