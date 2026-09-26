import "server-only";
import { withTenant } from "@/lib/db";
import { assertPermission } from "@/lib/permissions";
import { tenantOf, type Session } from "@/lib/session";

/**
 * The client side of the cycle: handing the currency over, and collecting the rupees.
 * A deal leaves two debts pointing opposite ways and they are never netted — a client can
 * owe us rupees while we still owe them euros. These functions settle each track on its own.
 */

export type PayoutInput = {
  clientId: number;
  date?: string;
  currency: string;
  fxAmount: string;
  accountCode?: string | null;
  referenceNo?: string | null;
  narration?: string | null;
  clientRef?: string | null;
};

export type ReceiptInput = {
  clientId: number;
  date?: string;
  inrAmount: string;
  accountCode?: string | null;
  allowAdvance?: boolean;
  referenceNo?: string | null;
  narration?: string | null;
  clientRef?: string | null;
};

export type PostedPayout = {
  id: string; voucherNo: string; currency: string; fxAmount: string;
  wasDueFx: string; nowDueFx: string; releasedInr: string; gainInr: string; duplicate: boolean;
};
export type PostedReceipt = {
  id: string; voucherNo: string; inrAmount: string;
  wasOwed: string; nowOwed: string; advanceInr: string; duplicate: boolean;
};

export async function postPayout(s: Session, v: PayoutInput): Promise<PostedPayout> {
  const payload = {
    client_id: v.clientId,
    date: v.date ?? null,
    currency: v.currency,
    fx_amount: v.fxAmount,
    account_code: v.accountCode ?? null,
    reference_no: v.referenceNo ?? null,
    narration: v.narration ?? null,
    client_ref: v.clientRef ?? null,
  };
  const out = await withTenant(await tenantOf(s), async (tx) => {
    const [r] = await tx<{ r: Record<string, string | boolean> }[]>`select ex.fn_post_payout(${tx.json(payload as never)}) as r`;
    return r.r;
  });
  return {
    id: String(out.id), voucherNo: String(out.voucher_no), currency: String(out.currency),
    fxAmount: String(out.fx_amount), wasDueFx: String(out.was_due_fx), nowDueFx: String(out.now_due_fx),
    releasedInr: String(out.released_inr), gainInr: String(out.gain_inr), duplicate: out.duplicate === true,
  };
}

export async function postReceipt(s: Session, v: ReceiptInput): Promise<PostedReceipt> {
  const payload = {
    client_id: v.clientId,
    date: v.date ?? null,
    inr_amount: v.inrAmount,
    account_code: v.accountCode ?? null,
    allow_advance: v.allowAdvance ?? false,
    reference_no: v.referenceNo ?? null,
    narration: v.narration ?? null,
    client_ref: v.clientRef ?? null,
  };
  const out = await withTenant(await tenantOf(s), async (tx) => {
    const [r] = await tx<{ r: Record<string, string | boolean> }[]>`select ex.fn_post_receipt(${tx.json(payload as never)}) as r`;
    return r.r;
  });
  return {
    id: String(out.id), voucherNo: String(out.voucher_no), inrAmount: String(out.inr_amount),
    wasOwed: String(out.was_owed), nowOwed: String(out.now_owed), advanceInr: String(out.advance_inr),
    duplicate: out.duplicate === true,
  };
}

export type ClientPositionRow = {
  party_id: string; party_code: string; full_name: string;
  billed_inr: string; received_inr: string; receivable_inr: string;
  promised_inr: string; delivered_inr: string; currency_payable_inr: string;
  last_receipt: string | null; last_payout: string | null;
};

/** Both tracks with their movement — billed vs received, promised vs delivered. */
export async function clientPositions(s: Session, q?: string | null): Promise<ClientPositionRow[]> {
  await assertPermission("report.view", s);
  const like = q ? `%${q}%` : null;
  return withTenant(await tenantOf(s), (tx) =>
    tx<ClientPositionRow[]>`
      select party_id, party_code, full_name,
             billed_inr::text, received_inr::text, receivable_inr::text,
             promised_inr::text, delivered_inr::text, currency_payable_inr::text,
             to_char(last_receipt, 'YYYY-MM-DD') as last_receipt,
             to_char(last_payout, 'YYYY-MM-DD')  as last_payout
        from ex.v_client_position
       where ${like}::text is null or full_name ilike ${like} or party_code ilike ${like}
       order by receivable_inr desc, full_name`);
}

export type ClientStatementLine = {
  voucher_id: string; voucher_no: string; voucher_date: string; voucher_type: string;
  narration: string | null; reference_no: string | null; track: "RUPEES" | "CURRENCY";
  currency_code: string; fx_amount: string; manual_rate: string;
  debit_inr: string; credit_inr: string; balance_inr: string;
};

/**
 * A client's statement, both tracks at once. Rupees they owe us run one way, currency we owe
 * them runs the other, and each keeps its own running balance — because they are settled
 * separately and the client checks them separately.
 */
export async function clientStatement(
  s: Session, partyId: number, from?: string, to?: string,
): Promise<{
  party: { id: string; party_code: string; full_name: string } | null;
  rupees: { opening: string; lines: ClientStatementLine[]; closing: string };
  currency: { opening: string; lines: ClientStatementLine[]; closing: string };
}> {
  await assertPermission("report.view", s);
  const empty = { opening: "0.00", lines: [] as ClientStatementLine[], closing: "0.00" };
  return withTenant(await tenantOf(s), async (tx) => {
    const [party] = await tx<{ id: string; party_code: string; full_name: string }[]>`
      select id, party_code, full_name from ex.party where id = ${partyId} and is_client`;
    if (!party) return { party: null, rupees: empty, currency: empty };

    const track = async (group: "RECEIVABLE" | "CURRENCY_PAYABLE", sign: 1 | -1) => {
      const [{ b: opening }] = await tx<{ b: string }[]>`
        select coalesce(${sign} * sum(case when l.dc = 'D' then l.inr_amount else -l.inr_amount end), 0)::text as b
          from ex.voucher_line l
          join ex.voucher v on v.id = l.voucher_id
          join ex.account a on a.id = l.account_id and a.account_group = ${group}
         where l.party_id = ${partyId} and (${from ?? null}::date is null or v.voucher_date < ${from ?? null})`;
      const rows = await tx<Omit<ClientStatementLine, "balance_inr" | "track">[]>`
        select v.id as voucher_id, v.voucher_no, to_char(v.voucher_date, 'YYYY-MM-DD') as voucher_date,
               v.voucher_type, v.narration, v.reference_no, trim(l.currency_code) as currency_code,
               l.fx_amount::text, l.manual_rate::text,
               (case when l.dc = 'D' then l.inr_amount else 0 end)::text as debit_inr,
               (case when l.dc = 'C' then l.inr_amount else 0 end)::text as credit_inr
          from ex.voucher_line l
          join ex.voucher v on v.id = l.voucher_id
          join ex.account a on a.id = l.account_id and a.account_group = ${group}
         where l.party_id = ${partyId}
           and (${from ?? null}::date is null or v.voucher_date >= ${from ?? null})
           and (${to ?? null}::date is null or v.voucher_date <= ${to ?? null})
         order by v.voucher_date, v.id, l.line_no`;
      let acc = Math.round(Number(opening) * 100);
      const lines: ClientStatementLine[] = rows.map((r) => {
        acc += sign * (Math.round(Number(r.debit_inr) * 100) - Math.round(Number(r.credit_inr) * 100));
        return { ...r, track: group === "RECEIVABLE" ? "RUPEES" : "CURRENCY", balance_inr: (acc / 100).toFixed(2) };
      });
      return { opening: Number(opening).toFixed(2), lines, closing: (acc / 100).toFixed(2) };
    };

    // receivable is a debit balance, currency payable a credit one — both shown as positive debts
    const [rupees, currency] = await Promise.all([track("RECEIVABLE", 1), track("CURRENCY_PAYABLE", -1)]);
    return { party, rupees, currency };
  });
}
