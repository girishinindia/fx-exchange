import "server-only";
import { withTenant } from "@/lib/db";
import type { LineInput, PostedVoucher, VoucherInput, VoucherType } from "@/lib/ledger";
import { assertPermission } from "@/lib/permissions";
import { tenantOf, type Session } from "@/lib/session";

/**
 * Everything that reads or writes the ledger goes through here — the portal's server
 * actions and /api/v1 both call these functions, so a rule is written once.
 * Writing is always ex.fn_post_voucher: the database checks permission, balance,
 * account currency, party kind, negative cash and the financial-year lock.
 */

export type VoucherRow = {
  id: string; voucher_no: string; voucher_type: VoucherType; voucher_date: string; status: string;
  party_id: string | null; party_name: string | null; narration: string | null; reference_no: string | null;
  total_inr: string; created_by_name: string | null; posted_at: Date;
  reversal_of: string | null; reversed_by: string | null;
  reversal_of_no: string | null; reversed_by_no: string | null;
  /** what moved in the drawers: rupee accounts as "Cash −4,525 · Bank +8,450", foreign currency as "USD −100" (0023) */
  cash_move: string | null; fx_move: string | null;
};
export type VoucherLineRow = {
  line_no: number; account_id: string; account_code: string; account_name: string; party_id: string | null;
  party_name: string | null; currency_code: string; fx_amount: string; manual_rate: string; inr_amount: string;
  dc: "D" | "C"; remarks: string | null;
};

const lineJson = (l: LineInput) => ({
  account_code: l.accountCode,
  account_id: l.accountId,
  party_id: l.partyId ?? null,
  currency: l.currency,
  fx_amount: l.fxAmount,
  rate: l.rate,
  inr_amount: l.inrAmount,
  dc: l.dc,
  deal_id: l.dealId ?? null,
  remarks: l.remarks ?? null,
});

/** Post a voucher. The only write path into ex.voucher / ex.voucher_line. */
export async function postVoucher(s: Session, v: VoucherInput): Promise<PostedVoucher> {
  const payload = {
    type: v.type,
    date: v.date,
    party_id: v.partyId ?? null,
    narration: v.narration ?? null,
    reference_no: v.referenceNo ?? null,
    rate_justification: v.rateJustification ?? null,
    client_ref: v.clientRef ?? null,
    lines: v.lines.map(lineJson),
  };
  const out = await withTenant(await tenantOf(s), async (tx) => {
    const [r] = await tx<{ r: { id: string; voucher_no: string; total_inr?: string; duplicate: boolean } }[]>`
      select ex.fn_post_voucher(${tx.json(payload as never)}) as r`;
    return r.r;
  });
  // every money value crosses this boundary as a string — the API contract promises decimals, not floats
  return { id: String(out.id), voucherNo: out.voucher_no, totalInr: out.total_inr === undefined ? undefined : String(out.total_inr), duplicate: out.duplicate };
}

export type VoucherFilter = { from?: string; to?: string; type?: VoucherType | null; partyId?: number | null; q?: string | null; limit?: number; offset?: number };

export async function listVouchers(s: Session, f: VoucherFilter = {}): Promise<{ rows: VoucherRow[]; total: number }> {
  await assertPermission("voucher.view", s);
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const offset = Math.max(f.offset ?? 0, 0);
  const like = f.q ? `%${f.q}%` : null;
  return withTenant(await tenantOf(s), async (tx) => {
    const where = tx`
      (${f.from ?? null}::date is null or v.voucher_date >= ${f.from ?? null})
      and (${f.to ?? null}::date is null or v.voucher_date <= ${f.to ?? null})
      and (${f.type ?? null}::text is null or v.voucher_type = ${f.type ?? null})
      and (${f.partyId ?? null}::bigint is null or v.party_id = ${f.partyId ?? null})
      and (${like}::text is null or v.voucher_no ilike ${like} or p.full_name ilike ${like}
           or v.narration ilike ${like} or v.reference_no ilike ${like})`;
    const rows = await tx<VoucherRow[]>`
      select v.id, v.voucher_no, v.voucher_type, to_char(v.voucher_date, 'YYYY-MM-DD') as voucher_date, v.status,
             v.party_id, p.full_name as party_name, v.narration, v.reference_no, v.total_inr::text,
             u.full_name as created_by_name, v.posted_at,
             v.reversal_of, v.reversed_by, null::text as reversal_of_no, null::text as reversed_by_no,
             mv.cash_move, mv.fx_move
        from ex.voucher v
        left join ex.party p on p.id = v.party_id
        left join ex.app_user u on u.id = v.created_by
        left join lateral (
          select string_agg(case when x.is_base then regexp_replace(x.name, ' — .*$', '') || ' ' || (case when x.inr < 0 then '−' else '+' end) || to_char(abs(x.inr), 'FM99,99,99,99,990') end, ' · ' order by x.sort_order) as cash_move,
                 string_agg(case when not x.is_base and x.fx <> 0 then trim(x.currency_code) || ' ' || (case when x.fx < 0 then '−' else '+' end) || to_char(abs(x.fx), 'FM99,99,99,99,990.00') end, ' · ' order by x.sort_order) as fx_move
            from (select a.name, a.sort_order, a.currency_code, (trim(a.currency_code) = (select trim(base_currency_code) from ex.company)) as is_base,
                         sum(case when l.dc = 'D' then l.fx_amount else -l.fx_amount end) as fx,
                         sum(case when l.dc = 'D' then l.inr_amount else -l.inr_amount end) as inr
                    from ex.voucher_line l join ex.account a on a.id = l.account_id
                   where l.voucher_id = v.id and a.account_group = 'CASH_BANK'
                   group by a.id, a.name, a.sort_order, a.currency_code) x
           where x.fx <> 0 or x.inr <> 0) mv on true
       where ${where}
       order by v.voucher_date desc, v.id desc
       limit ${limit} offset ${offset}`;
    const [{ n }] = await tx<{ n: number }[]>`
      select count(*)::int as n from ex.voucher v left join ex.party p on p.id = v.party_id where ${where}`;
    return { rows, total: n };
  });
}

export async function getVoucher(s: Session, id: number): Promise<{ voucher: VoucherRow; lines: VoucherLineRow[] } | null> {
  await assertPermission("voucher.view", s);
  return withTenant(await tenantOf(s), async (tx) => {
    const [voucher] = await tx<VoucherRow[]>`
      select v.id, v.voucher_no, v.voucher_type, to_char(v.voucher_date, 'YYYY-MM-DD') as voucher_date, v.status,
             v.party_id, p.full_name as party_name, v.narration, v.reference_no, v.total_inr::text,
             u.full_name as created_by_name, v.posted_at,
             v.reversal_of, v.reversed_by,
             (select o.voucher_no from ex.voucher o where o.id = v.reversal_of) as reversal_of_no,
             (select o.voucher_no from ex.voucher o where o.id = v.reversed_by) as reversed_by_no
        from ex.voucher v
        left join ex.party p on p.id = v.party_id
        left join ex.app_user u on u.id = v.created_by
       where v.id = ${id}`;
    if (!voucher) return null;
    const lines = await tx<VoucherLineRow[]>`
      select l.line_no, l.account_id, a.code as account_code, a.name as account_name, l.party_id, p.full_name as party_name,
             l.currency_code, l.fx_amount::text, l.manual_rate::text, l.inr_amount::text, l.dc, l.remarks
        from ex.voucher_line l
        join ex.account a on a.id = l.account_id
        left join ex.party p on p.id = l.party_id
       where l.voucher_id = ${id}
       order by l.line_no`;
    return { voucher, lines };
  });
}

export type TrialBalanceRow = { account_id: string; code: string; name: string; account_type: string; account_group: string; debit_inr: string; credit_inr: string };

export async function trialBalance(s: Session): Promise<{ rows: TrialBalanceRow[]; debit: string; credit: string; balanced: boolean }> {
  await assertPermission("report.view", s);
  return withTenant(await tenantOf(s), async (tx) => {
    const rows = await tx<TrialBalanceRow[]>`
      select account_id, code, name, account_type, account_group, debit_inr::text, credit_inr::text
        from ex.v_trial_balance order by account_type, code`;
    const debit = rows.reduce((a, r) => a + Number(r.debit_inr), 0);
    const credit = rows.reduce((a, r) => a + Number(r.credit_inr), 0);
    return { rows, debit: debit.toFixed(2), credit: credit.toFixed(2), balanced: Math.abs(debit - credit) < 0.005 };
  });
}

export type PositionRow = { account_id: string; code: string; name: string; currency_code: string; balance_fx: string; balance_inr: string; carrying_rate: string | null };

export async function currencyPosition(s: Session): Promise<PositionRow[]> {
  await assertPermission("report.view", s);
  return withTenant(await tenantOf(s), (tx) =>
    tx<PositionRow[]>`
      select account_id, code, name, currency_code, balance_fx::text, balance_inr::text, carrying_rate::text
        from ex.v_currency_position order by currency_code`);
}

export type LedgerEntry = {
  voucher_id: string; voucher_no: string; voucher_date: string; voucher_type: VoucherType; narration: string | null;
  party_name: string | null; currency_code: string; fx_amount: string; manual_rate: string; debit_inr: string; credit_inr: string;
};

/** Account ledger: every line that hit one account, in date order. */
export async function accountLedger(s: Session, accountId: number, from?: string, to?: string): Promise<{ opening: string; entries: LedgerEntry[] }> {
  await assertPermission("report.view", s);
  return withTenant(await tenantOf(s), async (tx) => {
    const [op] = await tx<{ opening: string }[]>`
      select coalesce(sum(case when l.dc = 'D' then l.inr_amount else -l.inr_amount end), 0)::text as opening
        from ex.voucher_line l join ex.voucher v on v.id = l.voucher_id
       where l.account_id = ${accountId} and ${from ?? null}::date is not null and v.voucher_date < ${from ?? null}`;
    const entries = await tx<LedgerEntry[]>`
      select v.id as voucher_id, v.voucher_no, to_char(v.voucher_date, 'YYYY-MM-DD') as voucher_date, v.voucher_type,
             coalesce(l.remarks, v.narration) as narration, p.full_name as party_name, l.currency_code,
             l.fx_amount::text, l.manual_rate::text,
             (case when l.dc = 'D' then l.inr_amount else 0 end)::text as debit_inr,
             (case when l.dc = 'C' then l.inr_amount else 0 end)::text as credit_inr
        from ex.voucher_line l
        join ex.voucher v on v.id = l.voucher_id
        left join ex.party p on p.id = l.party_id
       where l.account_id = ${accountId}
         and (${from ?? null}::date is null or v.voucher_date >= ${from ?? null})
         and (${to ?? null}::date is null or v.voucher_date <= ${to ?? null})
       order by v.voucher_date, v.id, l.line_no`;
    return { opening: op?.opening ?? "0", entries };
  });
}

/** Party ledger: the party's own account lines (receivable / payable / currency payable). */
export async function partyLedger(s: Session, partyId: number, from?: string, to?: string): Promise<{ opening: string; entries: (LedgerEntry & { account_code: string })[] }> {
  await assertPermission("report.view", s);
  return withTenant(await tenantOf(s), async (tx) => {
    const [op] = await tx<{ opening: string }[]>`
      select coalesce(sum(case when l.dc = 'D' then l.inr_amount else -l.inr_amount end), 0)::text as opening
        from ex.voucher_line l join ex.voucher v on v.id = l.voucher_id
       where l.party_id = ${partyId} and ${from ?? null}::date is not null and v.voucher_date < ${from ?? null}`;
    const entries = await tx<(LedgerEntry & { account_code: string })[]>`
      select v.id as voucher_id, v.voucher_no, to_char(v.voucher_date, 'YYYY-MM-DD') as voucher_date, v.voucher_type,
             coalesce(l.remarks, v.narration) as narration, p.full_name as party_name, a.code as account_code,
             l.currency_code, l.fx_amount::text, l.manual_rate::text,
             (case when l.dc = 'D' then l.inr_amount else 0 end)::text as debit_inr,
             (case when l.dc = 'C' then l.inr_amount else 0 end)::text as credit_inr
        from ex.voucher_line l
        join ex.voucher v on v.id = l.voucher_id
        join ex.account a on a.id = l.account_id
        left join ex.party p on p.id = l.party_id
       where l.party_id = ${partyId}
         and (${from ?? null}::date is null or v.voucher_date >= ${from ?? null})
         and (${to ?? null}::date is null or v.voucher_date <= ${to ?? null})
       order by v.voucher_date, v.id, l.line_no`;
    return { opening: op?.opening ?? "0", entries };
  });
}

export type PartyBalanceRow = {
  party_id: string; party_code: string; full_name: string; account_code: string; account_group: string;
  currency_code: string; balance_fx: string; balance_inr: string;
};

export async function partyBalances(s: Session, kind?: "CLIENT" | "DEPOSITOR"): Promise<PartyBalanceRow[]> {
  await assertPermission("report.view", s);
  return withTenant(await tenantOf(s), (tx) =>
    tx<PartyBalanceRow[]>`
      select b.party_id, b.party_code, b.full_name, b.account_code, b.account_group, b.currency_code,
             b.balance_fx::text, b.balance_inr::text
        from ex.v_party_balance b
        join ex.party p on p.id = b.party_id
       where (${kind ?? null}::text is null
              or (${kind ?? null} = 'CLIENT' and p.is_client) or (${kind ?? null} = 'DEPOSITOR' and p.is_depositor))
         and (b.balance_inr <> 0 or b.balance_fx <> 0)
       order by b.full_name, b.account_code`);
}

/** The home screen: what we hold, what we owe, what we are owed. */
export async function liquidity(s: Session) {
  await assertPermission("report.view", s);
  return withTenant(await tenantOf(s), async (tx) => {
    const cash = await tx<{ code: string; name: string; currency_code: string; balance_fx: string; balance_inr: string }[]>`
      select code, name, currency_code, balance_fx::text, balance_inr::text from ex.v_currency_position order by currency_code`;
    const [totals] = await tx<{ owed_to_depositors: string; to_collect: string; currency_to_deliver: string; margin: string; expenses: string }[]>`
      select coalesce(-sum(balance_inr) filter (where account_group = 'PAYABLE'), 0)::text          as owed_to_depositors,
             coalesce(sum(balance_inr) filter (where account_group = 'RECEIVABLE'), 0)::text        as to_collect,
             coalesce(-sum(balance_inr) filter (where account_group = 'CURRENCY_PAYABLE'), 0)::text as currency_to_deliver,
             coalesce(-sum(balance_inr) filter (where account_group in ('INCOME','ROUNDING')), 0)::text as margin,
             coalesce(sum(balance_inr) filter (where account_type = 'EXPENSE'), 0)::text            as expenses
        from ex.v_account_balance`;
    const [tb] = await tx<{ dr: string; cr: string }[]>`
      select coalesce(sum(debit_inr), 0)::text as dr, coalesce(sum(credit_inr), 0)::text as cr from ex.v_trial_balance`;
    // Cover, currency by currency: what we promised clients in EUR is only covered by EUR we hold.
    // Currencies never net against each other, so this is never a single rupee comparison.
    const cover = await tx<{ currency_code: string; held_fx: string; owed_fx: string }[]>`
      select trim(l.currency_code) as currency_code,
             coalesce( sum(case when a.account_group = 'CASH_BANK'
                                then case when l.dc = 'D' then l.fx_amount else -l.fx_amount end end), 0)::text as held_fx,
             coalesce(-sum(case when a.account_group = 'CURRENCY_PAYABLE'
                                then case when l.dc = 'D' then l.fx_amount else -l.fx_amount end end), 0)::text as owed_fx
        from ex.voucher_line l
        join ex.voucher v on v.id = l.voucher_id
        join ex.account a on a.id = l.account_id
       where a.account_group in ('CASH_BANK', 'CURRENCY_PAYABLE')
       group by 1 order by 1`;
    const vouchers = await tx<VoucherRow[]>`
      select v.id, v.voucher_no, v.voucher_type, to_char(v.voucher_date, 'YYYY-MM-DD') as voucher_date, v.status,
             v.party_id, p.full_name as party_name, v.narration, v.reference_no, v.total_inr::text,
             u.full_name as created_by_name, v.posted_at
        from ex.voucher v left join ex.party p on p.id = v.party_id left join ex.app_user u on u.id = v.created_by
       order by v.id desc limit 8`;
    return { cash, totals, tb, cover, vouchers };
  });
}
