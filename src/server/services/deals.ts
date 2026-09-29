import "server-only";
import { withTenant } from "@/lib/db";
import { assertPermission } from "@/lib/permissions";
import { tenantOf, type Session } from "@/lib/session";

/**
 * Deals — where the company earns.
 * A deal spends the primary currency that depositors brought in, at the rate each of those
 * deposits actually cost, and bills the client in rupees at the rate agreed with them.
 * `ex.fn_post_deal` does the allocation and the posting in one transaction, so a deal can
 * never take currency that is not there, and the margin is always billing minus real cost.
 */

export type DealRow = {
  deal_id: string; voucher_id: string; voucher_no: string; deal_date: string;
  client_id: string; party_code: string; client_name: string;
  src_currency: string; src_amount: string; src_cost_inr: string;
  fx_currency: string; fx_amount: string; src_to_fx_rate: string; fx_to_inr_rate: string;
  billed_inr: string; margin_inr: string; margin_pct: string | null; average_cost_rate: string | null;
  funding_slices: number; status: string; reference_no: string | null; narration: string | null;
};

export type FundingSlice = { depositId: number; fxAllocated: string };

export type DealInput = {
  clientId: number;
  date?: string;
  fxCurrency: string;
  fxAmount: string;
  fxToInrRate: string;
  /** the currency the deal is funded from — the one sold, when the desk holds it as itself; the dealing currency otherwise */
  srcCurrency?: string | null;
  /** how much of the funding currency it spends — the amount sold when funded from the same currency */
  srcAmount?: string | null;
  funding?: FundingSlice[];
  referenceNo?: string | null;
  narration?: string | null;
  rateJustification?: string | null;
  clientRef?: string | null;
};

export type PostedDeal = {
  id: string; voucherId: string; voucherNo: string;
  billedInr: string; srcCostInr: string; marginInr: string;
  fxAmount?: string; srcAmount?: string; srcCurrency?: string; duplicate: boolean;
};

export async function postDeal(s: Session, d: DealInput): Promise<PostedDeal> {
  const payload = {
    client_id: d.clientId,
    date: d.date ?? null,
    fx_currency: d.fxCurrency,
    fx_amount: d.fxAmount,
    fx_to_inr_rate: d.fxToInrRate,
    src_currency: d.srcCurrency ?? null,
    src_amount: d.srcAmount ?? null,
    funding: d.funding?.length
      ? d.funding.map((f) => ({ deposit_id: f.depositId, fx_allocated: f.fxAllocated }))
      : undefined,
    reference_no: d.referenceNo ?? null,
    narration: d.narration ?? null,
    rate_justification: d.rateJustification ?? null,
    client_ref: d.clientRef ?? null,
  };
  const out = await withTenant(await tenantOf(s), async (tx) => {
    const [r] = await tx<{ r: Record<string, string | boolean> }[]>`select ex.fn_post_deal(${tx.json(payload as never)}) as r`;
    return r.r;
  });
  return {
    id: String(out.id), voucherId: String(out.voucher_id), voucherNo: String(out.voucher_no),
    billedInr: String(out.billed_inr), srcCostInr: String(out.src_cost_inr), marginInr: String(out.margin_inr),
    fxAmount: out.fx_amount === undefined ? undefined : String(out.fx_amount),
    srcAmount: out.src_amount === undefined ? undefined : String(out.src_amount),
    srcCurrency: out.src_currency === undefined ? undefined : String(out.src_currency),
    duplicate: out.duplicate === true,
  };
}

export type DealFilter = { from?: string; to?: string; clientId?: number | null; currency?: string | null; q?: string | null; limit?: number; offset?: number };

export async function listDeals(
  s: Session, f: DealFilter = {},
): Promise<{ rows: DealRow[]; total: number; totals: { billed: string; cost: string; margin: string } }> {
  await assertPermission("voucher.view", s);
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const offset = Math.max(f.offset ?? 0, 0);
  const like = f.q ? `%${f.q}%` : null;
  return withTenant(await tenantOf(s), async (tx) => {
    const where = tx`
      (${f.from ?? null}::date is null or d.deal_date >= ${f.from ?? null})
      and (${f.to ?? null}::date is null or d.deal_date <= ${f.to ?? null})
      and (${f.clientId ?? null}::bigint is null or d.client_id = ${f.clientId ?? null})
      and (${f.currency ?? null}::text is null or trim(d.fx_currency) = ${f.currency ?? null})
      and (${like}::text is null or d.client_name ilike ${like} or d.voucher_no ilike ${like}
           or d.reference_no ilike ${like} or d.narration ilike ${like})`;
    const rows = await tx<DealRow[]>`
      select d.deal_id, d.voucher_id, d.voucher_no, to_char(d.deal_date, 'YYYY-MM-DD') as deal_date,
             d.client_id, d.party_code, d.client_name,
             trim(d.src_currency) as src_currency, d.src_amount::text, d.src_cost_inr::text,
             trim(d.fx_currency) as fx_currency, d.fx_amount::text, d.src_to_fx_rate::text, d.fx_to_inr_rate::text,
             d.billed_inr::text, d.margin_inr::text, d.margin_pct::text, d.average_cost_rate::text,
             d.funding_slices::int, d.status, d.reference_no, d.narration
        from ex.v_deal_status d
       where ${where}
       order by d.deal_date desc, d.deal_id desc
       limit ${limit} offset ${offset}`;
    const [agg] = await tx<{ n: number; billed: string; cost: string; margin: string }[]>`
      select count(*)::int as n,
             coalesce(sum(d.billed_inr), 0)::text   as billed,
             coalesce(sum(d.src_cost_inr), 0)::text as cost,
             coalesce(sum(d.margin_inr), 0)::text   as margin
        from ex.v_deal_status d where ${where}`;
    return { rows, total: agg.n, totals: { billed: agg.billed, cost: agg.cost, margin: agg.margin } };
  });
}

export type FundingRow = {
  deposit_id: string; voucher_no: string; deposit_date: string; depositor_name: string;
  fx_allocated: string; manual_rate: string; cost_inr: string;
};

export async function getDeal(s: Session, id: number): Promise<{ deal: DealRow; funding: FundingRow[] } | null> {
  await assertPermission("voucher.view", s);
  return withTenant(await tenantOf(s), async (tx) => {
    const [deal] = await tx<DealRow[]>`
      select d.deal_id, d.voucher_id, d.voucher_no, to_char(d.deal_date, 'YYYY-MM-DD') as deal_date,
             d.client_id, d.party_code, d.client_name,
             trim(d.src_currency) as src_currency, d.src_amount::text, d.src_cost_inr::text,
             trim(d.fx_currency) as fx_currency, d.fx_amount::text, d.src_to_fx_rate::text, d.fx_to_inr_rate::text,
             d.billed_inr::text, d.margin_inr::text, d.margin_pct::text, d.average_cost_rate::text,
             d.funding_slices::int, d.status, d.reference_no, d.narration
        from ex.v_deal_status d where d.deal_id = ${id}`;
    if (!deal) return null;
    const funding = await tx<FundingRow[]>`
      select f.deposit_id, s.voucher_no, to_char(s.deposit_date, 'YYYY-MM-DD') as deposit_date,
             s.depositor_name, f.fx_allocated::text, f.manual_rate::text, f.cost_inr::text
        from ex.deal_funding f
        join ex.v_deposit_status s on s.deposit_id = f.deposit_id
       where f.deal_id = ${id}
       order by s.deposit_date, f.deposit_id`;
    return { deal, funding };
  });
}

export type AvailableDeposit = {
  deposit_id: string; voucher_no: string; deposit_date: string; depositor_name: string;
  manual_rate: string; fx_unallocated: string;
  /** the currency this deposit is held in — the dealing currency, or the one kept (0023) */
  currency_code: string;
};

/** Deposits with currency still unspent, oldest first — what a new deal can draw on. */
export async function availableDeposits(s: Session, onDate?: string): Promise<AvailableDeposit[]> {
  await assertPermission("voucher.view", s);
  return withTenant(await tenantOf(s), (tx) =>
    tx<AvailableDeposit[]>`
      select s.deposit_id, s.voucher_no, to_char(s.deposit_date, 'YYYY-MM-DD') as deposit_date,
             s.depositor_name, d.manual_rate::text, s.fx_unallocated::text, trim(s.currency_code) as currency_code
        from ex.v_deposit_status s
        join ex.deposit d on d.id = s.deposit_id
       where s.fx_unallocated > 0 and s.status = 'POSTED'
         and (${onDate ?? null}::date is null or s.deposit_date <= ${onDate ?? null})
       order by s.deposit_date, s.deposit_id`);
}

export type ClientSummaryRow = {
  party_id: string; party_code: string; full_name: string; deal_count: number;
  total_billed: string; total_margin: string; first_deal: string | null; last_deal: string | null;
  receivable_inr: string; currency_payable_inr: string;
};

export async function clientSummary(s: Session, q?: string | null): Promise<ClientSummaryRow[]> {
  await assertPermission("report.view", s);
  const like = q ? `%${q}%` : null;
  return withTenant(await tenantOf(s), (tx) =>
    tx<ClientSummaryRow[]>`
      select party_id, party_code, full_name, deal_count::int as deal_count,
             total_billed::text, total_margin::text,
             to_char(first_deal, 'YYYY-MM-DD') as first_deal,
             to_char(last_deal, 'YYYY-MM-DD')  as last_deal,
             receivable_inr::text, currency_payable_inr::text
        from ex.v_client_summary
       where ${like}::text is null or full_name ilike ${like} or party_code ilike ${like}
       order by receivable_inr desc, full_name`);
}

export type CurrencyDueRow = { party_id: string; party_code: string; full_name: string; currency_code: string; fx_due: string; inr_value: string };

/** Currency promised to clients and not yet handed over, per client and per currency. */
export async function currencyDue(s: Session, partyId?: number): Promise<CurrencyDueRow[]> {
  await assertPermission("report.view", s);
  return withTenant(await tenantOf(s), (tx) =>
    tx<CurrencyDueRow[]>`
      select party_id, party_code, full_name, currency_code, fx_due::text, inr_value::text
        from ex.v_currency_due
       where ${partyId ?? null}::bigint is null or party_id = ${partyId ?? null}
       order by full_name, currency_code`);
}
