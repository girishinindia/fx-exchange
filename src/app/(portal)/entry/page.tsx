import type { Metadata } from "next";
import Link from "next/link";
import { Card, Icon, Note } from "@/components/ui";
import { getCompanyInfo } from "@/lib/company";
import { withTenant } from "@/lib/db";
import { fmtDate, todayISO } from "@/lib/format";
import { getPermissions } from "@/lib/permissions";
import { requireSession, tenantOf } from "@/lib/session";
import { daySheet, walkIn } from "@/server/services/day";
import { availableDeposits } from "@/server/services/deals";
import { DayGrid } from "./DayGrid";
import { EntryForm, type CashOpt, type ExpenseOpt, type LineKind, type PartyOpt } from "./EntryForm";

export const metadata: Metadata = { title: "Entry" };

/**
 * The day sheet — the client's whiteboard, typed. The entry line on top (Buy | Sell | Expense |
 * Cash⇄Bank), the grid of the day underneath: one column per drawer, one row per line, closing
 * at the bottom. Any past day opens the same way with ?date=.
 */
export default async function EntryPage({ searchParams }: PageProps<"/entry">) {
  const s = await requireSession();
  if (s.preview) return <Note tone="amber">Needs a real login.</Note>;
  const perms = await getPermissions(s);
  const company = await getCompanyInfo(s);
  const sp = await searchParams;
  const mode: LineKind = sp.mode === "buy" ? "buy" : sp.mode === "expense" ? "expense" : sp.mode === "transfer" ? "transfer" : "sell";
  const today = todayISO();
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const canEnter = perms.has("deal.manage") || perms.has("voucher.create");

  // the walk-in party exists from the first time somebody who can post opens this page
  if (canEnter) await walkIn(s).catch(() => null);

  const [parties, currencies, cash, expenseHeads] = await withTenant(await tenantOf(s), async (tx) => {
    const parties = await tx<PartyOpt[]>`
      select p.id::text as id, p.full_name, p.party_code, p.phone, p.is_client, p.is_depositor, (p.party_code = 'WALK-IN') as walk_in,
             coalesce((select sum(b.balance_inr) from ex.v_party_balance b where b.party_id = p.id and b.account_group = 'RECEIVABLE'), 0)::text as receivable_inr,
             coalesce((select sum(d.fx_due) from ex.v_depositor_due d where d.party_id = p.id), 0)::text as owed_fx,
             coalesce((select sum(d.inr_value) from ex.v_depositor_due d where d.party_id = p.id), 0)::text as owed_inr
        from ex.party p where p.is_active order by (p.party_code = 'WALK-IN') desc, p.full_name`;
    const currencies = await tx<{ code: string }[]>`
      select trim(currency_code) as code from ex.company_currency where is_active order by (trim(currency_code) = ${company.primaryCurrency}) desc, display_order, currency_code`;
    const cash = await tx<CashOpt[]>`
      select a.code, a.name, trim(a.currency_code) as currency_code from ex.account a
       where a.is_active and a.account_group = 'CASH_BANK' order by a.sort_order, a.code`;
    const expenseHeads = await tx<ExpenseOpt[]>`
      select a.code, a.name from ex.account a
       where a.is_active and a.account_type = 'EXPENSE' and a.code not in ('FX-LOSS', 'UNREAL-FX') order by a.sort_order, a.name`;
    return [parties, currencies.map((c) => c.code).filter((c) => c !== company.baseCurrency), cash, expenseHeads] as const;
  });
  const deposits = perms.has("voucher.view") ? await availableDeposits(s) : [];
  const sheet = perms.has("report.view") ? await daySheet(s, date) : null;
  const isToday = date === today;
  const shift = (n: number) => { const d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  return (
    <div className="space-y-4">
      {canEnter && isToday ? (
        <Card>
          <EntryForm mode={mode} parties={parties} currencies={currencies} deposits={deposits} cash={cash} expenseHeads={expenseHeads}
            base={company.baseCurrency} primary={company.primaryCurrency} today={today}
            canSell={perms.has("deal.manage")} canCreate={perms.has("voucher.create")} />
        </Card>
      ) : !isToday ? (
        <Note tone="sky" icon="fa-calendar-day">You are looking at <b>{fmtDate(date)}</b>. New lines are added on today&rsquo;s sheet — <Link href="/entry" className="font-semibold underline">back to today</Link>. A line dated in the past can still be posted from the full forms under More.</Note>
      ) : (
        <Note tone="amber">Your account can read the day sheet but not add to it.</Note>
      )}

      {sheet ? (
        <Card padded={false} title={`The board · ${fmtDate(date)}`} icon="fa-table-cells"
              actions={
                <span className="flex items-center gap-2 text-xs">
                  <Link href={`/entry?date=${shift(-1)}`} className="rounded-lg border border-slate-200 px-2 py-1 hover:bg-slate-50" title="the day before"><Icon name="fa-chevron-left" /></Link>
                  <input type="date" defaultValue={date} max={today} form="daynav" name="date" className="rounded-lg border border-slate-200 px-2 py-1 text-xs" />
                  <form id="daynav" action="/entry" method="get"><button type="submit" className="rounded-lg border border-slate-200 px-2 py-1 hover:bg-slate-50">Go</button></form>
                  {!isToday && <Link href={`/entry?date=${shift(1)}`} className="rounded-lg border border-slate-200 px-2 py-1 hover:bg-slate-50" title="the day after"><Icon name="fa-chevron-right" /></Link>}
                  <span className="text-slate-500">{sheet.rows.length} {sheet.rows.length === 1 ? "line" : "lines"}</span>
                </span>
              }>
          <DayGrid d={sheet} canRevalue={perms.has("fy.lock")} />
        </Card>
      ) : (
        <Note tone="amber">The board needs the report permission.</Note>
      )}
    </div>
  );
}
