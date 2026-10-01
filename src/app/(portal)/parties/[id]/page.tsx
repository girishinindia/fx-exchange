import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Icon, Kpi, LinkButton, Note, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { balanceLabel } from "@/lib/ledger";
import { formatINR, formatQty , formatRate } from "@/lib/money";
import { getPermissions } from "@/lib/permissions";
import { requireSession } from "@/lib/session";
import { DepositorCycle, type Cycle } from "@/components/DepositorCycle";
import { withTenant } from "@/lib/db";
import { tenantOf } from "@/lib/session";
import { partyBalances, partyLedger } from "@/server/services/ledger";
import { getParty } from "@/server/services/parties";

type Earned = {
  funded_deals: number; currency_dealt: string; cost_of_that: string;
  dealing_margin: string; rate_gain: string; total_earned: string;
};

export const metadata: Metadata = { title: "Party" };

export default async function PartyPage({ params }: PageProps<"/parties/[id]">) {
  const s = await requireSession();
  if (s.preview) return <Note tone="amber">Needs a real login.</Note>;
  const perms = await getPermissions(s);
  if (!perms.has("party.view")) return <Note tone="rose">You do not have permission to see parties.</Note>;
  const { id } = await params;
  const party = await getParty(s, Number(id));
  if (!party) notFound();

  const [balances, ledger] = await Promise.all([
    perms.has("report.view") ? partyBalances(s) : Promise.resolve([]),
    perms.has("report.view") ? partyLedger(s, Number(id)) : Promise.resolve({ opening: "0", entries: [] }),
  ]);
  // what the desk has made out of this depositor, and what they are still owed, in currency
  const [earned, owedFx, cycle] = party.is_depositor && perms.has("report.view")
    ? await withTenant(await tenantOf(s), async (tx) => {
        const [e] = await tx<Earned[]>`
          select funded_deals::int as funded_deals, currency_dealt::text, cost_of_that::text,
                 dealing_margin::text, rate_gain::text, total_earned::text
            from ex.v_depositor_profit where party_id = ${Number(id)}`;
        const due = await tx<{ currency_code: string; fx_due: string; inr_value: string }[]>`
          select currency_code, fx_due::text, inr_value::text
            from ex.v_depositor_due where party_id = ${Number(id)} order by inr_value desc`;
        const [cy] = await tx<Cycle[]>`
          select currency, status, deposit_count::int as deposit_count, deposited_fx::text, deposited_inr::text,
                 dealt_fx::text, unspent_fx::text, deal_count::int as deal_count,
                 billed_inr::text, collected_inr::text, uncollected_inr::text,
                 settled_fx::text, settled_inr::text, owed_fx::text, owed_inr::text, earned_inr::text
            from ex.v_depositor_cycle where party_id = ${Number(id)}`;
        return [e ?? null, due, cy ?? null] as const;
      })
    : [null, [] as { currency_code: string; fx_due: string; inr_value: string }[], null];

  const mine = balances.filter((b) => b.party_id === String(party.id));
  const receivable = mine.filter((b) => b.account_group === "RECEIVABLE").reduce((a, b) => a + Number(b.balance_inr), 0);
  const payable = mine.filter((b) => b.account_group === "PAYABLE").reduce((a, b) => a - Number(b.balance_inr), 0);
  const currencyDue = mine.filter((b) => b.account_group === "CURRENCY_PAYABLE");
  // running balance computed up front (no mutation during render)
  const withBalance = ledger.entries.reduce<{ rows: (typeof ledger.entries[number] & { running: number })[]; acc: number }>(
    (s2, e) => {
      const acc = s2.acc + Number(e.debit_inr) - Number(e.credit_inr);
      s2.rows.push({ ...e, running: acc });
      return { rows: s2.rows, acc };
    },
    { rows: [], acc: 0 },
  ).rows;

  return (
    <>
      <PageHeader
        title={party.full_name}
        crumbs={["Parties"]}
        subtitle={<>{party.party_code} · {party.is_depositor && <Badge tone="violet">Depositor</Badge>} {party.is_client && <Badge tone="sky">Client</Badge>} {party.phone ? `· ${party.phone}` : ""}</>}
        actions={
          <span className="flex flex-wrap gap-2">
            {party.is_depositor && perms.has("report.view") && (
              <LinkButton href={`/reports/depositorstatement?party=${party.id}`} icon="fa-file-invoice-dollar" variant="ghost">Statement</LinkButton>
            )}
            {party.is_depositor && perms.has("voucher.create") && Number(payable) > 0 && (
              <LinkButton href={`/settlements/new?depositor=${party.id}`} icon="fa-up-long" variant="ghost">Settle</LinkButton>
            )}
            {perms.has("party.manage") && <LinkButton href={`/parties/${party.id}/edit`} icon="fa-pen" variant="ghost">Edit</LinkButton>}
          </span>
        }
      />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {party.is_client && <Kpi label="Owes us (rupees)" value={formatINR(receivable, { decimals: 0 })} sub={balanceLabel(receivable, "CLIENT")} icon="fa-file-invoice" tone="sky" />}
        {party.is_client && (
          <Kpi label="Currency still to deliver" icon="fa-coins" tone="amber"
            value={currencyDue.length ? currencyDue.map((c) => `${formatQty(-Number(c.balance_fx), 2)} ${c.currency_code.trim()}`).join(" · ") : "—"}
            sub={currencyDue.length ? formatINR(currencyDue.reduce((a, c) => a - Number(c.balance_inr), 0), { decimals: 0 }) : "nothing pending"} />
        )}
        {party.is_depositor && (
          <Kpi label="We owe" icon="fa-hand-holding-dollar" tone="rose"
            value={owedFx.length ? owedFx.map((c) => `${formatQty(c.fx_due, 2)} ${c.currency_code.trim()}`).join(" · ") : "—"}
            sub={owedFx.length ? `carried at ${formatINR(payable, { decimals: 0 })}` : balanceLabel(-payable, "DEPOSITOR")} />
        )}
      </div>

      {cycle && (
        <Card title={`${party.full_name}'s money, round the loop`} icon="fa-rotate"
              actions={<LinkButton href="/reports/cycles" variant="ghost">Every depositor</LinkButton>}>
          <DepositorCycle c={cycle} name={party.full_name} />
        </Card>
      )}

      {earned && (
        <Card title="What this depositor has earned us" icon="fa-chart-line"
              actions={<LinkButton href={`/reports/depositorprofit?q=${encodeURIComponent(party.full_name)}`} variant="ghost">All depositors</LinkButton>}>
          {earned.funded_deals === 0 && Number(earned.rate_gain) === 0 ? (
            <p className="text-sm text-slate-600">
              None of {party.full_name}&apos;s money has gone out on a deal yet, and nothing has been settled, so there is nothing
              to show. That is not the same as nothing to earn — it appears here the moment their currency funds a deal.
            </p>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Kpi label="Deals their money funded" value={String(earned.funded_deals)}
                  sub={Number(earned.currency_dealt) ? `${formatQty(earned.currency_dealt, 2)} dealt out` : "nothing dealt yet"}
                  icon="fa-right-left" tone="sky" />
                <Kpi label="Margin on those deals" value={formatINR(earned.dealing_margin, { decimals: 0 })}
                  sub="their share of what each deal made" icon="fa-percent" tone="emerald" />
                <Kpi label="On the rate" value={formatINR(earned.rate_gain, { decimals: 0 })}
                  sub={Number(earned.rate_gain) === 0 ? "nothing settled yet" : Number(earned.rate_gain) > 0 ? "the rate moved our way" : "the rate moved against us"}
                  icon="fa-arrow-trend-up" tone={Number(earned.rate_gain) < 0 ? "rose" : "violet"} />
                <Kpi label="Earned altogether" value={formatINR(earned.total_earned, { decimals: 0 })}
                  sub={`against ${formatINR(earned.cost_of_that, { decimals: 0 })} of their money spent`} icon="fa-sack-dollar" tone="amber" />
              </div>
              <p className="mt-3 text-xs text-slate-500">
                <Icon name="fa-circle-info" className="mr-1" />
                The margin is each deal&apos;s own margin split across the deposits that paid for it, in proportion to what each
                one cost — so every depositor&apos;s share added together is the company&apos;s margin exactly, counted once.
              </p>
            </>
          )}
        </Card>
      )}

      <Card title="Ledger" icon="fa-book" padded={false} actions={<LinkButton href={`/reports/partybalances?q=${encodeURIComponent(party.full_name)}`} variant="ghost">All balances</LinkButton>}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-sky-50/70">
              <tr>{["Date", "Voucher", "Particulars", "Currency", "Amount", "Rate", "Debit (₹)", "Credit (₹)", "Balance (₹)"].map((h, i) => (
                <th key={h} className={`px-4 py-2.5 text-xs font-semibold uppercase text-slate-500 ${i >= 4 ? "text-right" : "text-left"}`}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {ledger.entries.length === 0 && <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">No entries yet.</td></tr>}
              {withBalance.map((e, i) => {
                return (
                  <tr key={`${e.voucher_id}-${i}`} className="border-t border-sky-50 hover:bg-sky-50/50">
                    <td className="px-4 py-2.5 text-slate-600">{fmtDate(e.voucher_date)}</td>
                    <td className="px-4 py-2.5"><Link href={`/vouchers/${e.voucher_id}`} className="text-sky-700 font-medium">{e.voucher_no.split("/").pop()}</Link></td>
                    <td className="px-4 py-2.5">{e.narration ?? e.voucher_type}</td>
                    <td className="px-4 py-2.5">{e.currency_code.trim()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatQty(e.fx_amount, 2)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{Number(e.manual_rate) === 1 ? "—" : formatRate(e.manual_rate)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{Number(e.debit_inr) ? formatINR(e.debit_inr) : ""}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{Number(e.credit_inr) ? formatINR(e.credit_inr) : ""}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatINR(Math.abs(e.running))} {e.running >= 0 ? "Dr" : "Cr"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {party.notes && <Note icon="fa-note-sticky">{party.notes}</Note>}
      <p className="text-xs text-slate-500"><Icon name="fa-circle-info" className="mr-1" />Currency owed and rupees owed are two separate balances — neither cancels the other.</p>
    </>
  );
}
