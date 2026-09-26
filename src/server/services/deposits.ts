import "server-only";
import { withTenant } from "@/lib/db";
import { assertPermission } from "@/lib/permissions";
import { tenantOf, type Session } from "@/lib/session";

/**
 * Deposits and settlements — the depositor half of the cycle.
 * Both write through Postgres functions (`ex.fn_post_deposit`, `ex.fn_post_settlement`),
 * which post an ordinary voucher, so every ledger guard still applies. The portal and
 * /api/v1 both call the functions here.
 */

export type DepositRow = {
  deposit_id: string; voucher_id: string; voucher_no: string; deposit_date: string;
  depositor_id: string; party_code: string; depositor_name: string;
  currency_code: string; fx_amount: string; manual_rate: string; inr_amount: string;
  fx_allocated: string; fx_unallocated: string; status: string;
  reference_no: string | null; narration: string | null;
};

export type DepositorRow = {
  party_id: string; party_code: string; full_name: string; deposit_count: number;
  currency_brought_in: string; value_brought_in: string; average_rate: string | null;
  first_deposit: string | null; last_deposit: string | null;
  total_credited: string; total_settled: string; outstanding_inr: string;
};

export type DepositInput = {
  depositorId: number;
  date?: string;
  /** what the depositor handed over; the dealing currency when not given */
  currency?: string | null;
  fxAmount: string;
  /** one unit of that, in dealing currency — only when the two differ */
  toPrimaryRate?: string | null;
  rate: string;
  referenceNo?: string | null;
  narration?: string | null;
  rateJustification?: string | null;
  clientRef?: string | null;
};

export type SettlementInput = {
  depositorId: number;
  date?: string;
  /** what the depositor is owed in — the desk's dealing currency unless it is a rupee balance */
  currency?: string | null;
  /** the amount of that currency being settled */
  fxAmount: string;
  /** the rupee rate agreed for it today; 1 when the balance is already in rupees */
  rate?: string | null;
  accountCode?: string | null;
  referenceNo?: string | null;
  narration?: string | null;
  clientRef?: string | null;
};

export type PostedDeposit = {
  id: string; voucherId: string; voucherNo: string;
  /** what came through the door */
  receivedCurrency: string; receivedAmount: string; toPrimaryRate: string;
  /** what it became: dealing currency, its rupee rate, and the rupees it is carried at */
  fxAmount: string; manualRate: string; inrAmount: string;
  duplicate: boolean;
};
export type PostedSettlement = {
  id: string; voucherNo: string;
  /** the rupees actually handed over */
  inrAmount: string;
  currency: string; fxAmount: string; rate: string;
  /** what the promise was carried at, and the slice of it released */
  carriedAt: string; releasedInr: string;
  /** positive when the rate moved the desk's way, negative when it did not */
  gainInr: string;
  wasOwedFx: string; nowOwedFx: string;
  duplicate: boolean;
};

export async function postDeposit(s: Session, d: DepositInput): Promise<PostedDeposit> {
  const payload = {
    depositor_id: d.depositorId,
    date: d.date ?? null,
    currency: d.currency ?? null,
    fx_amount: d.fxAmount,
    to_primary_rate: d.toPrimaryRate ?? null,
    rate: d.rate,
    reference_no: d.referenceNo ?? null,
    narration: d.narration ?? null,
    rate_justification: d.rateJustification ?? null,
    client_ref: d.clientRef ?? null,
  };
  const out = await withTenant(await tenantOf(s), async (tx) => {
    const [r] = await tx<{ r: Record<string, string | boolean> }[]>`select ex.fn_post_deposit(${tx.json(payload as never)}) as r`;
    return r.r;
  });
  return {
    id: String(out.id), voucherId: String(out.voucher_id), voucherNo: String(out.voucher_no),
    receivedCurrency: String(out.received_currency), receivedAmount: String(out.received_amount),
    toPrimaryRate: String(out.to_primary_rate),
    fxAmount: String(out.fx_amount), manualRate: String(out.manual_rate), inrAmount: String(out.inr_amount),
    duplicate: out.duplicate === true,
  };
}

export async function postSettlement(s: Session, v: SettlementInput): Promise<PostedSettlement> {
  const payload = {
    depositor_id: v.depositorId,
    date: v.date ?? null,
    currency: v.currency ?? null,
    fx_amount: v.fxAmount,
    rate: v.rate ?? null,
    account_code: v.accountCode ?? null,
    reference_no: v.referenceNo ?? null,
    narration: v.narration ?? null,
    client_ref: v.clientRef ?? null,
  };
  const out = await withTenant(await tenantOf(s), async (tx) => {
    const [r] = await tx<{ r: Record<string, string | boolean> }[]>`select ex.fn_post_settlement(${tx.json(payload as never)}) as r`;
    return r.r;
  });
  return {
    id: String(out.id), voucherNo: String(out.voucher_no), inrAmount: String(out.inr_amount),
    currency: String(out.currency), fxAmount: String(out.fx_amount), rate: String(out.rate),
    carriedAt: String(out.carried_at), releasedInr: String(out.released_inr),
    gainInr: String(out.gain_inr ?? "0"),
    wasOwedFx: String(out.was_owed_fx ?? "0"), nowOwedFx: String(out.now_owed_fx ?? "0"),
    duplicate: out.duplicate === true,
  };
}

export type DepositFilter = { from?: string; to?: string; depositorId?: number | null; q?: string | null; unallocatedOnly?: boolean; limit?: number; offset?: number };

export async function listDeposits(s: Session, f: DepositFilter = {}): Promise<{ rows: DepositRow[]; total: number; totals: { fx: string; inr: string; unallocated: string } }> {
  await assertPermission("voucher.view", s);
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const offset = Math.max(f.offset ?? 0, 0);
  const like = f.q ? `%${f.q}%` : null;
  return withTenant(await tenantOf(s), async (tx) => {
    const where = tx`
      (${f.from ?? null}::date is null or d.deposit_date >= ${f.from ?? null})
      and (${f.to ?? null}::date is null or d.deposit_date <= ${f.to ?? null})
      and (${f.depositorId ?? null}::bigint is null or d.depositor_id = ${f.depositorId ?? null})
      and (${f.unallocatedOnly ? true : null}::boolean is null or d.fx_unallocated > 0)
      and (${like}::text is null or d.depositor_name ilike ${like} or d.voucher_no ilike ${like}
           or v.reference_no ilike ${like} or v.narration ilike ${like})`;
    const rows = await tx<DepositRow[]>`
      select d.deposit_id, d.voucher_id, d.voucher_no, to_char(d.deposit_date, 'YYYY-MM-DD') as deposit_date,
             d.depositor_id, d.party_code, d.depositor_name, d.currency_code,
             d.fx_amount::text, d.manual_rate::text, d.inr_amount::text,
             d.fx_allocated::text, d.fx_unallocated::text, d.status,
             v.reference_no, v.narration
        from ex.v_deposit_status d
        join ex.voucher v on v.id = d.voucher_id
       where ${where}
       order by d.deposit_date desc, d.deposit_id desc
       limit ${limit} offset ${offset}`;
    const [agg] = await tx<{ n: number; fx: string; inr: string; un: string }[]>`
      select count(*)::int as n,
             coalesce(sum(d.fx_amount), 0)::text as fx,
             coalesce(sum(d.inr_amount), 0)::text as inr,
             coalesce(sum(d.fx_unallocated), 0)::text as un
        from ex.v_deposit_status d join ex.voucher v on v.id = d.voucher_id
       where ${where}`;
    return { rows, total: agg.n, totals: { fx: agg.fx, inr: agg.inr, unallocated: agg.un } };
  });
}

/** One line per depositor: brought in, paid back, still owed. */
export async function depositorSummary(s: Session, q?: string | null): Promise<DepositorRow[]> {
  await assertPermission("report.view", s);
  const like = q ? `%${q}%` : null;
  return withTenant(await tenantOf(s), (tx) =>
    tx<DepositorRow[]>`
      select party_id, party_code, full_name, deposit_count::int as deposit_count,
             currency_brought_in::text, value_brought_in::text, average_rate::text,
             to_char(first_deposit, 'YYYY-MM-DD') as first_deposit,
             to_char(last_deposit, 'YYYY-MM-DD')  as last_deposit,
             total_credited::text, total_settled::text, outstanding_inr::text
        from ex.v_depositor_summary
       where ${like}::text is null or full_name ilike ${like} or party_code ilike ${like}
       order by outstanding_inr desc, full_name`);
}

export type StatementLine = {
  voucher_id: string; voucher_no: string; voucher_date: string; voucher_type: string;
  narration: string | null; reference_no: string | null;
  currency_code: string; fx_amount: string; manual_rate: string;
  debit_inr: string; credit_inr: string; balance_inr: string;
};

/**
 * A depositor's statement: what they brought in, what we paid back, and what is left —
 * with the balance after every line, which is the number they will check.
 */
export async function depositorStatement(
  s: Session, partyId: number, from?: string, to?: string,
): Promise<{ party: { id: string; party_code: string; full_name: string } | null; opening: string; lines: StatementLine[]; closing: string }> {
  await assertPermission("report.view", s);
  return withTenant(await tenantOf(s), async (tx) => {
    const [party] = await tx<{ id: string; party_code: string; full_name: string }[]>`
      select id, party_code, full_name from ex.party where id = ${partyId} and is_depositor`;
    if (!party) return { party: null, opening: "0.00", lines: [], closing: "0.00" };

    const balanceOf = (upto: string | null) => tx<{ b: string }[]>`
      select coalesce(-sum(case when l.dc = 'D' then l.inr_amount else -l.inr_amount end), 0)::text as b
        from ex.voucher_line l
        join ex.voucher v on v.id = l.voucher_id
        join ex.account a on a.id = l.account_id and a.account_group = 'PAYABLE'
       where l.party_id = ${partyId} and (${upto}::date is null or v.voucher_date < ${upto})`;

    const [{ b: opening }] = await balanceOf(from ?? null);
    const rows = await tx<Omit<StatementLine, "balance_inr">[]>`
      select v.id as voucher_id, v.voucher_no, to_char(v.voucher_date, 'YYYY-MM-DD') as voucher_date,
             v.voucher_type, v.narration, v.reference_no, l.currency_code,
             l.fx_amount::text, l.manual_rate::text,
             (case when l.dc = 'D' then l.inr_amount else 0 end)::text as debit_inr,
             (case when l.dc = 'C' then l.inr_amount else 0 end)::text as credit_inr
        from ex.voucher_line l
        join ex.voucher v on v.id = l.voucher_id
        join ex.account a on a.id = l.account_id and a.account_group = 'PAYABLE'
       where l.party_id = ${partyId}
         and (${from ?? null}::date is null or v.voucher_date >= ${from ?? null})
         and (${to ?? null}::date is null or v.voucher_date <= ${to ?? null})
       order by v.voucher_date, v.id, l.line_no`;

    // running balance in paise, so nothing drifts
    let acc = Math.round(Number(opening) * 100);
    const lines: StatementLine[] = rows.map((r) => {
      acc += Math.round(Number(r.credit_inr) * 100) - Math.round(Number(r.debit_inr) * 100);
      return { ...r, balance_inr: (acc / 100).toFixed(2) };
    });
    return { party, opening: Number(opening).toFixed(2), lines, closing: (acc / 100).toFixed(2) };
  });
}
