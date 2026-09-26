import "server-only";
import { withTenant } from "@/lib/db";
import { assertPermission } from "@/lib/permissions";
import { tenantOf, type Session } from "@/lib/session";

/**
 * Putting things right, and closing the year.
 * A posted voucher is never edited: it is cancelled by an equal and opposite one, and both
 * stay on the record. Once the CA has signed a year off it is locked, and the currency the
 * company still holds is restated at the closing rate so the books show today's value.
 */

export type ReversedVoucher = { id: string; voucherNo: string; reversed: string; reason: string };

export async function reverseVoucher(s: Session, voucherId: number, reason: string): Promise<ReversedVoucher> {
  const out = await withTenant(await tenantOf(s), async (tx) => {
    const [r] = await tx<{ r: Record<string, string> }[]>`select ex.fn_reverse_voucher(${voucherId}, ${reason}) as r`;
    return r.r;
  });
  return { id: String(out.id), voucherNo: String(out.voucher_no), reversed: String(out.reversed), reason: String(out.reason) };
}

export type FyRow = {
  id: string; fy_code: string; start_date: string; end_date: string; status: string;
  locked_at: string | null; locked_by_name: string | null; lock_note: string | null;
  vouchers: number; first_voucher: string | null; last_voucher: string | null;
};

export async function listFinancialYears(s: Session): Promise<FyRow[]> {
  await assertPermission("report.view", s);
  return withTenant(await tenantOf(s), (tx) =>
    tx<FyRow[]>`
      select f.id, f.fy_code, to_char(f.start_date, 'YYYY-MM-DD') as start_date,
             to_char(f.end_date, 'YYYY-MM-DD') as end_date, f.status,
             to_char(f.locked_at, 'YYYY-MM-DD') as locked_at, u.full_name as locked_by_name, f.lock_note,
             (select count(*)::int from ex.voucher v where v.fy_id = f.id) as vouchers,
             (select to_char(min(v.voucher_date), 'YYYY-MM-DD') from ex.voucher v where v.fy_id = f.id) as first_voucher,
             (select to_char(max(v.voucher_date), 'YYYY-MM-DD') from ex.voucher v where v.fy_id = f.id) as last_voucher
        from ex.fy_period f
        left join ex.app_user u on u.id = f.locked_by
       order by f.start_date desc`);
}

export async function lockFinancialYear(s: Session, fyId: number, note: string): Promise<{ fyCode: string; status: string }> {
  const out = await withTenant(await tenantOf(s), async (tx) => {
    const [r] = await tx<{ r: Record<string, string> }[]>`select ex.fn_lock_fy(${fyId}, ${note}) as r`;
    return r.r;
  });
  return { fyCode: String(out.fy_code), status: String(out.status) };
}

export async function unlockFinancialYear(s: Session, fyId: number, reason: string): Promise<{ fyCode: string; status: string }> {
  const out = await withTenant(await tenantOf(s), async (tx) => {
    const [r] = await tx<{ r: Record<string, string> }[]>`select ex.fn_unlock_fy(${fyId}, ${reason}) as r`;
    return r.r;
  });
  return { fyCode: String(out.fy_code), status: String(out.status) };
}

export type OpenPosition = { currency_code: string; held_fx: string; held_inr: string; owed_fx: string; owed_inr: string; carrying_rate: string | null };

/**
 * Every currency with something still in it — what a revaluation would restate.
 * The book currency is left out: rupees are what everything else is measured against, so there is
 * no rate to restate them at, and `fn_revalue_currency` refuses one. Listing them would only offer
 * the desk a box it is not allowed to fill in.
 */
export async function openPositions(s: Session): Promise<OpenPosition[]> {
  await assertPermission("report.view", s);
  return withTenant(await tenantOf(s), (tx) =>
    tx<OpenPosition[]>`
      with base as (select base_currency_code as cur from ex.company),
      held as (
        select trim(currency_code) as cur, sum(balance_fx) as fx, sum(balance_inr) as inr
          from ex.v_currency_position group by 1),
      -- both promises: currency owed to clients, and dealing currency owed to depositors.
      -- fn_revalue_currency restates both, so the preview has to count both or it will
      -- show a gain on dollars the desk does not actually have.
      owed as (
        select cur, sum(fx) as fx, sum(inr) as inr from (
          select trim(currency_code) as cur, fx_due as fx, inr_value as inr from ex.v_currency_due
          union all
          select trim(currency_code) as cur, fx_due as fx, inr_value as inr from ex.v_depositor_due
        ) o group by 1)
      select coalesce(h.cur, o.cur) as currency_code,
             coalesce(h.fx, 0)::text as held_fx, coalesce(h.inr, 0)::text as held_inr,
             coalesce(o.fx, 0)::text as owed_fx, coalesce(o.inr, 0)::text as owed_inr,
             case when coalesce(h.fx, 0) <> 0 then round(h.inr / h.fx, 6) end::text as carrying_rate
        from held h full outer join owed o on o.cur = h.cur
       where (coalesce(h.fx, 0) <> 0 or coalesce(o.fx, 0) <> 0)
         and coalesce(h.cur, o.cur) <> (select trim(cur) from base)
       order by 1`);
}

export type RevaluationResult = {
  nothingToDo: boolean; voucherNo?: string; gainInr: string;
  positions: { account: string; party?: string; currency: string; fx: string; was: string; now: string }[];
};

export async function revalue(
  s: Session, rates: { currency: string; rate: string }[], date?: string, narration?: string,
): Promise<RevaluationResult> {
  const payload = { date: date ?? null, rates, narration: narration ?? null };
  const out = await withTenant(await tenantOf(s), async (tx) => {
    const [r] = await tx<{ r: Record<string, unknown> }[]>`select ex.fn_revalue_currency(${tx.json(payload as never)}) as r`;
    return r.r;
  });
  return {
    nothingToDo: out.nothing_to_do === true,
    voucherNo: out.voucher_no === undefined ? undefined : String(out.voucher_no),
    gainInr: String(out.gain_inr ?? "0.00"),
    positions: (out.positions ?? []) as RevaluationResult["positions"],
  };
}
