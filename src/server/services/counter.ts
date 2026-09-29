import "server-only";
import { withTenant } from "@/lib/db";
import { assertPermission } from "@/lib/permissions";
import { tenantOf, type Session } from "@/lib/session";
import type { DealInput } from "./deals";
import type { DepositInput } from "./deposits";

/**
 * The counter — fast entry. A sale or a purchase and, when the client or the
 * depositor settles on the spot, its follow-ups, posted in ONE database
 * transaction through the same functions the individual screens use. All or
 * nothing: if any rule refuses (a missing rate, currency the desk does not
 * hold, a closed year) nothing is posted and the refusal is the message.
 *
 * Nothing here is a new kind of entry. A sale with both boxes ticked is a
 * DEAL, a PAY and a RCT voucher — exactly what three separate screens post.
 */

type Raw = Record<string, string | boolean | null | undefined>;

export type SaleInput = {
  deal: DealInput;
  /** hand the currency over now — out of this account (the currency's cash account by default) */
  handOver?: { accountCode?: string | null } | null;
  /** take the rupees now — the billed amount unless a different one is given; into this account */
  collect?: { inrAmount?: string | null; accountCode?: string | null; allowAdvance?: boolean } | null;
};

export type PostedSale = {
  deal: { id: string; voucherId: string; voucherNo: string; billedInr: string; srcCostInr: string; marginInr: string; fxAmount: string; srcAmount: string; srcCurrency: string };
  payout: { id: string; voucherNo: string; nowDueFx: string; gainInr: string } | null;
  receipt: { id: string; voucherNo: string; inrAmount: string; nowOwed: string; advanceInr: string } | null;
};

export async function postSale(s: Session, v: SaleInput): Promise<PostedSale> {
  await assertPermission("deal.manage", s);
  if (v.handOver || v.collect) await assertPermission("voucher.create", s);
  const d = v.deal;
  const dealPayload = {
    client_id: d.clientId, date: d.date ?? null, fx_currency: d.fxCurrency, fx_amount: d.fxAmount,
    fx_to_inr_rate: d.fxToInrRate, src_currency: d.srcCurrency ?? null, src_amount: d.srcAmount ?? null,
    funding: d.funding?.length ? d.funding.map((f) => ({ deposit_id: f.depositId, fx_allocated: f.fxAllocated })) : undefined,
    reference_no: d.referenceNo ?? null, narration: d.narration ?? null, rate_justification: d.rateJustification ?? null,
    client_ref: d.clientRef ?? null,
  };
  return withTenant(await tenantOf(s), async (tx) => {
    const [dr] = await tx<{ r: Raw }[]>`select ex.fn_post_deal(${tx.json(dealPayload as never)}) as r`;
    const deal = dr.r;
    let payout: PostedSale["payout"] = null;
    let receipt: PostedSale["receipt"] = null;
    if (v.handOver) {
      const [pr] = await tx<{ r: Raw }[]>`select ex.fn_post_payout(${tx.json({
        client_id: d.clientId, date: d.date ?? null, currency: d.fxCurrency, fx_amount: String(deal.fx_amount ?? d.fxAmount),
        account_code: v.handOver.accountCode ?? null, reference_no: d.referenceNo ?? null,
        narration: `Handed over with ${String(deal.voucher_no)}`,
        client_ref: d.clientRef ? `${d.clientRef}:pay` : null,
      } as never)}) as r`;
      payout = { id: String(pr.r.id), voucherNo: String(pr.r.voucher_no), nowDueFx: String(pr.r.now_due_fx), gainInr: String(pr.r.gain_inr ?? "0") };
    }
    if (v.collect) {
      const [rr] = await tx<{ r: Raw }[]>`select ex.fn_post_receipt(${tx.json({
        client_id: d.clientId, date: d.date ?? null,
        inr_amount: v.collect.inrAmount ?? String(deal.billed_inr),
        account_code: v.collect.accountCode ?? null, allow_advance: v.collect.allowAdvance ?? false,
        reference_no: d.referenceNo ?? null, narration: `Received against ${String(deal.voucher_no)}`,
        client_ref: d.clientRef ? `${d.clientRef}:rct` : null,
      } as never)}) as r`;
      receipt = { id: String(rr.r.id), voucherNo: String(rr.r.voucher_no), inrAmount: String(rr.r.inr_amount), nowOwed: String(rr.r.now_owed), advanceInr: String(rr.r.advance_inr ?? "0") };
    }
    return {
      deal: {
        id: String(deal.id), voucherId: String(deal.voucher_id), voucherNo: String(deal.voucher_no),
        billedInr: String(deal.billed_inr), srcCostInr: String(deal.src_cost_inr), marginInr: String(deal.margin_inr),
        fxAmount: String(deal.fx_amount ?? d.fxAmount), srcAmount: String(deal.src_amount ?? d.srcAmount ?? ""), srcCurrency: String(deal.src_currency ?? ""),
      },
      payout, receipt,
    };
  });
}

export type PurchaseInput = {
  deposit: DepositInput;
  /** pay the depositor now, in rupees, at this rate — 1 unit of the currency held (dealing currency, or the one kept) in rupees; accountCode: the rupee account paid from */
  payNow?: { rate: string; accountCode?: string | null } | null;
};

export type PostedPurchase = {
  deposit: { id: string; voucherId: string; voucherNo: string; fxAmount: string; manualRate: string; inrAmount: string; currency: string; kept: boolean };
  settlement: { id: string; voucherNo: string; inrAmount: string; gainInr: string; nowOwedFx: string } | null;
};

export async function postPurchase(s: Session, v: PurchaseInput): Promise<PostedPurchase> {
  await assertPermission("voucher.create", s);
  const d = v.deposit;
  const depPayload = {
    depositor_id: d.depositorId, date: d.date ?? null, currency: d.currency ?? null, fx_amount: d.fxAmount,
    to_primary_rate: d.toPrimaryRate ?? null, keep: d.keep ?? false, rate: d.rate, reference_no: d.referenceNo ?? null,
    narration: d.narration ?? null, rate_justification: d.rateJustification ?? null, client_ref: d.clientRef ?? null,
  };
  return withTenant(await tenantOf(s), async (tx) => {
    const [dr] = await tx<{ r: Raw }[]>`select ex.fn_post_deposit(${tx.json(depPayload as never)}) as r`;
    const dep = dr.r;
    let settlement: PostedPurchase["settlement"] = null;
    if (v.payNow) {
      const [sr] = await tx<{ r: Raw }[]>`select ex.fn_post_settlement(${tx.json({
        depositor_id: d.depositorId, date: d.date ?? null, currency: dep.currency ?? null,
        fx_amount: String(dep.fx_amount), rate: v.payNow.rate,
        account_code: v.payNow.accountCode ?? null, reference_no: d.referenceNo ?? null,
        narration: `Paid on the spot for ${String(dep.voucher_no)}`,
        client_ref: d.clientRef ? `${d.clientRef}:set` : null,
      } as never)}) as r`;
      settlement = { id: String(sr.r.id), voucherNo: String(sr.r.voucher_no), inrAmount: String(sr.r.inr_amount), gainInr: String(sr.r.gain_inr ?? "0"), nowOwedFx: String(sr.r.now_owed_fx ?? "0") };
    }
    return {
      deposit: {
        id: String(dep.id), voucherId: String(dep.voucher_id), voucherNo: String(dep.voucher_no),
        fxAmount: String(dep.fx_amount), manualRate: String(dep.manual_rate), inrAmount: String(dep.inr_amount),
        currency: String(dep.currency ?? ""), kept: dep.kept === true,
      },
      settlement,
    };
  });
}

// ------------------------------------------------------------------- to-do
export type TodoItem = {
  kind: "HAND_OVER" | "COLLECT" | "PAY";
  partyId: string; partyCode: string; partyName: string;
  currency: string; fxAmount: string | null; inrAmount: string;
  /** the rate the promise is carried at, for a PAY item */
  carriedAt: string | null;
};

/**
 * What is still open at the counter, as one list: currency a client is still
 * to be handed, rupees a client still owes, currency a depositor is still owed.
 * Each line is one tap on the phone or one click on the web.
 */
export async function todo(s: Session): Promise<{ items: TodoItem[]; today: { count: number; date: string } }> {
  await assertPermission("report.view", s);
  return withTenant(await tenantOf(s), async (tx) => {
    const hand = await tx<{ party_id: string; party_code: string; full_name: string; currency_code: string; fx_due: string; inr_value: string }[]>`
      select d.party_id, p.party_code, d.full_name, trim(d.currency_code) as currency_code, d.fx_due::text, d.inr_value::text
        from ex.v_currency_due d join ex.party p on p.id = d.party_id
       where d.fx_due > 0 order by d.inr_value desc`;
    const collect = await tx<{ party_id: string; party_code: string; full_name: string; receivable_inr: string }[]>`
      select b.party_id, b.party_code, b.full_name, sum(b.balance_inr)::text as receivable_inr
        from ex.v_party_balance b where b.account_group = 'RECEIVABLE'
       group by b.party_id, b.party_code, b.full_name having sum(b.balance_inr) > 0 order by 4 desc`;
    const pay = await tx<{ party_id: string; party_code: string; full_name: string; currency_code: string; fx_due: string; inr_value: string }[]>`
      select d.party_id, p.party_code, d.full_name, trim(d.currency_code) as currency_code, d.fx_due::text, d.inr_value::text
        from ex.v_depositor_due d join ex.party p on p.id = d.party_id
       where d.fx_due > 0 order by d.inr_value desc`;
    const [t] = await tx<{ n: string; d: string }[]>`
      select count(*)::text as n, to_char(current_date, 'YYYY-MM-DD') as d from ex.voucher where voucher_date = current_date and status = 'POSTED'`;
    const items: TodoItem[] = [
      ...hand.map((r): TodoItem => ({ kind: "HAND_OVER", partyId: String(r.party_id), partyCode: r.party_code, partyName: r.full_name, currency: r.currency_code, fxAmount: r.fx_due, inrAmount: r.inr_value, carriedAt: null })),
      ...collect.map((r): TodoItem => ({ kind: "COLLECT", partyId: String(r.party_id), partyCode: r.party_code, partyName: r.full_name, currency: "INR", fxAmount: null, inrAmount: r.receivable_inr, carriedAt: null })),
      ...pay.map((r): TodoItem => ({ kind: "PAY", partyId: String(r.party_id), partyCode: r.party_code, partyName: r.full_name, currency: r.currency_code, fxAmount: r.fx_due, inrAmount: r.inr_value, carriedAt: Number(r.fx_due) ? (Number(r.inr_value) / Number(r.fx_due)).toFixed(6) : null })),
    ];
    return { items, today: { count: Number(t.n), date: t.d } };
  });
}
