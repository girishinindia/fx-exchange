/**
 * Deposits and settlements against a real database (always rolled back).
 * The story: two deposits at different rates, a part settlement, and every guard the desk
 * relies on — you cannot pay a depositor more than you owe them, or more rupees than you hold.
 *   DATABASE_ADMIN_URL — admin connection. Skipped when not set.
 */
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const ADMIN = process.env.DATABASE_ADMIN_URL;
class Rollback extends Error {}
type Tx = postgres.TransactionSql;

const call = async (tx: Tx, fn: "fn_post_deposit" | "fn_post_settlement" | "fn_post_voucher", p: Record<string, unknown>) => {
  const [r] = await tx<{ v: Record<string, string | boolean> }[]>`select ex.${tx(fn)}(${tx.json(p as never)}) as v`;
  return r.v;
};

async function setup(tx: Tx, code: string) {
  await tx`set local role ex_security`;
  const [{ cid }] = await tx`select (ex.fn_register_company(${code} || '_' || txid_current(), 'Deposit Test', 'Admin', ${code + "@test.invalid"}, 'x', 'INR', 'USD')->>'company_id')::bigint as cid`;
  await tx`set local role ex_app`;
  await tx`select set_config('app.company_id', ${String(cid)}, true)`;
  const [{ admin }] = await tx`select id as admin from ex.app_user where user_type = 'ADMIN'`;
  await tx`select set_config('app.user_id', ${String(admin)}, true)`;
  const [{ d1 }] = await tx`insert into ex.party (party_code, full_name, is_depositor) values ('D1', 'Rajesh Traders', true) returning id as d1`;
  const [{ d2 }] = await tx`insert into ex.party (party_code, full_name, is_depositor) values ('D2', 'Mehta & Sons', true) returning id as d2`;
  const [{ c1 }] = await tx`insert into ex.party (party_code, full_name, is_client) values ('C1', 'Kumar Overseas', true) returning id as c1`;
  return { d1, d2, c1 };
}

const rollback = async (sql: postgres.Sql, body: (tx: Tx) => Promise<void>) => {
  try {
    await sql.begin(async (tx) => { await body(tx); throw new Rollback(); });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
};

describe.skipIf(!ADMIN)("deposits and settlements", () => {
  const sql = postgres(ADMIN ?? "", { prepare: false, max: 1, onnotice: () => {} });
  afterAll(() => sql.end());

  it("records deposits at their own rates and settles in parts", async () => {
    const r: Record<string, unknown> = {};
    await rollback(sql, async (tx) => {
      const { d1, c1 } = await setup(tx, "DEP");

      const a = await call(tx, "fn_post_deposit", { depositor_id: d1, date: "2026-04-01", fx_amount: "10000", rate: "86", reference_no: "SWIFT-1" });
      const b = await call(tx, "fn_post_deposit", { depositor_id: d1, date: "2026-04-03", fx_amount: "5000", rate: "85.5" });
      r.first = a.voucher_no;
      r.second = b.voucher_no;
      r.owedAfterDeposits = a.inr_amount + " + " + b.inr_amount;

      // the ledger, not the deposit table, is what the depositor is owed
      [r.summary] = await tx`
        select deposit_count, currency_brought_in::text as fx, value_brought_in::text as inr,
               average_rate::text as rate, total_settled::text as settled, outstanding_inr::text as owed
          from ex.v_depositor_summary where party_id = ${d1}`;

      // bring in rupees from a client, then pay the depositor part of what is owed
      await call(tx, "fn_post_voucher", {
        type: "RECEIPT", date: "2026-04-04",
        lines: [{ account_code: "CASH-INR", fx_amount: "500000", dc: "D" },
                { account_code: "CLIENT-REC", party_id: c1, fx_amount: "500000", dc: "C" }],
      });
      // USD 5,000 of the 15,000 owed, at 88 — above the 85.833333 the promise is carried at,
      // so the desk pays 4,40,000 to release 4,29,166.67 and takes the difference as a loss
      const s1 = await call(tx, "fn_post_settlement", { depositor_id: d1, date: "2026-04-05", fx_amount: "5000", rate: "88", reference_no: "NEFT-9" });
      r.settlement = { no: s1.voucher_no, wasOwed: s1.was_owed_fx, nowOwed: s1.now_owed_fx,
                       paid: s1.inr_amount, released: s1.released_inr, gain: s1.gain_inr };

      [r.after] = await tx`
        select total_settled::text as settled, outstanding_inr::text as owed
          from ex.v_depositor_summary where party_id = ${d1}`;

      // the books still balance
      [r.tb] = await tx`select coalesce(sum(debit_inr),0)::text as dr, coalesce(sum(credit_inr),0)::text as cr from ex.v_trial_balance`;

      // nothing has been spent on a deal yet, so every dollar is still available
      r.unallocated = await tx`select voucher_no, fx_unallocated::text as un from ex.v_deposit_status order by voucher_no`;
    });

    expect(r.first).toContain("/DEP/00001");
    expect(r.second).toContain("/DEP/00002");
    expect(r.summary).toEqual({ deposit_count: "2", fx: "15000.0000", inr: "1287500.00", rate: "85.833333", settled: "0", owed: "1287500.00" });
    // the depositor is owed DOLLARS, so what was owed and what is left are dollars
    expect(r.settlement).toEqual({
      no: expect.stringContaining("/SET/00001"),
      wasOwed: "15000.0000", nowOwed: "10000.0000",
      paid: "440000.00", released: "429166.67", gain: "-10833.33",
    });
    // 5,000 × (88 − 85.833333) = 10,833.33 — the rate moved against the desk and it is recorded
    expect(r.after).toEqual({ settled: "429166.67", owed: "858333.33" });
    // Dr: CASH-USD 12,87,500 + CASH-INR 60,000 + FX-LOSS 10,833.33
    // Cr: DEP-PAY 8,58,333.33 + CLIENT-REC 5,00,000
    expect(r.tb).toEqual({ dr: "1358333.33", cr: "1358333.33" });
    expect(r.unallocated).toEqual([
      { voucher_no: expect.stringContaining("/DEP/00001"), un: "10000.0000" },
      { voucher_no: expect.stringContaining("/DEP/00002"), un: "5000.0000" },
    ]);
  });

  it("refuses a deposit or a settlement that would be wrong", async () => {
    const errs: string[] = [];
    // each refusal runs in its own savepoint — one error would otherwise poison the transaction
    const expectFail = async (tx: Tx, fn: "fn_post_deposit" | "fn_post_settlement", p: Record<string, unknown>) => {
      try {
        await tx.savepoint(async (sp) => { await call(sp as Tx, fn, p); });
        errs.push("NO ERROR");
      } catch (e) {
        errs.push((e as Error).message);
      }
    };
    await rollback(sql, async (tx) => {
      const { d1, c1 } = await setup(tx, "DEPG");
      // a currency the company has not enabled — not "any currency but USD", which is now allowed
      await expectFail(tx, "fn_post_deposit", { depositor_id: d1, fx_amount: "100", rate: "86", currency: "JPY" });
      await expectFail(tx, "fn_post_deposit", { depositor_id: c1, fx_amount: "100", rate: "86" });
      await expectFail(tx, "fn_post_deposit", { depositor_id: d1, fx_amount: "0", rate: "86" });
      await expectFail(tx, "fn_post_settlement", { depositor_id: d1, fx_amount: "1", rate: "86" });

      await call(tx, "fn_post_deposit", { depositor_id: d1, date: "2026-04-01", fx_amount: "1000", rate: "86" });
      // a settlement with no rate at all — the rate is never carried over from the deposit
      await expectFail(tx, "fn_post_settlement", { depositor_id: d1, fx_amount: "100" });
      await expectFail(tx, "fn_post_settlement", { depositor_id: d1, fx_amount: "9000", rate: "86" });   // more than owed
      await expectFail(tx, "fn_post_settlement", { depositor_id: d1, fx_amount: "1000", rate: "86" });   // owed, but no rupees held
    });

    expect(errs[0]).toContain("does not deal in JPY");
    expect(errs[1]).toContain("not an active depositor");
    expect(errs[2]).toContain("Enter the USD amount");
    expect(errs[3]).toContain("We do not owe this depositor any USD");
    expect(errs[4]).toContain("Enter the rate agreed for 1 USD today");
    expect(errs[5]).toContain("We owe this depositor only 1000.0000 USD");
    expect(errs[6]).toContain("Only 0.00 in CASH-INR");
  });

  it("takes a deposit in another currency and changes it into dollars", async () => {
    const r: Record<string, unknown> = {};
    await rollback(sql, async (tx) => {
      const { d1 } = await setup(tx, "DEPX");
      await tx`insert into ex.company_currency (currency_code, display_order, is_active) values ('EUR', 10, true)`;

      // EUR 10,000 across the counter; 1 EUR buys 1.08 USD; 1 USD is worth 86 rupees today
      const d = await call(tx, "fn_post_deposit", {
        depositor_id: d1, date: "2026-04-01", currency: "EUR", fx_amount: "10000",
        to_primary_rate: "1.08", rate: "86",
      });
      r.posted = { received: d.received_currency, amount: d.received_amount,
                   toPrimary: d.to_primary_rate, dollars: d.fx_amount, rupees: d.inr_amount };

      // the euros arrived and were changed — both are on the voucher, and they net to nothing
      r.lines = await tx`
        select a.code, l.dc, trim(l.currency_code) as cur, l.fx_amount::text as fx, l.inr_amount::text as inr
          from ex.voucher_line l join ex.account a on a.id = l.account_id
         where l.voucher_id = ${String(d.voucher_id)} order by l.line_no`;

      // so the desk holds dollars, and no euros at all
      r.held = await tx`
        select code, balance_fx::text as fx from ex.v_account_balance
         where account_group = 'CASH_BANK' and balance_fx <> 0 order by code`;

      // and the depositor is owed dollars, not euros and not rupees
      r.owed = await tx`select currency_code, fx_due::text as fx, inr_value::text as inr from ex.v_depositor_due where party_id = ${d1}`;

      // the deposit remembers what actually came in, beside what it became
      [r.row] = await tx`
        select received_currency, received_amount::text as recv, to_primary_rate::text as conv,
               currency_code, fx_amount::text as fx, was_converted
          from ex.v_deposit_status where depositor_id = ${d1}`;

      [r.tb] = await tx`select coalesce(sum(debit_inr),0)::text as dr, coalesce(sum(credit_inr),0)::text as cr from ex.v_trial_balance`;
    });

    // 10,000 × 1.08 = USD 10,800, and 10,800 × 86 = ₹9,28,800
    expect(r.posted).toEqual({ received: "EUR", amount: "10000.0000", toPrimary: "1.080000",
                               dollars: "10800.0000", rupees: "928800.00" });
    expect(r.lines).toEqual([
      { code: "CASH-EUR", dc: "D", cur: "EUR", fx: "10000.0000", inr: "928800.00" },
      { code: "CASH-EUR", dc: "C", cur: "EUR", fx: "10000.0000", inr: "928800.00" },
      { code: "CASH-USD", dc: "D", cur: "USD", fx: "10800.0000", inr: "928800.00" },
      { code: "DEP-PAY",  dc: "C", cur: "USD", fx: "10800.0000", inr: "928800.00" },
    ]);
    expect(r.held).toEqual([{ code: "CASH-USD", fx: "10800.0000" }]);
    expect(r.owed).toEqual([{ currency_code: "USD", fx: "10800.0000", inr: "928800.00" }]);
    expect(r.row).toEqual({ received_currency: "EUR", recv: "10000.0000", conv: "1.080000",
                            currency_code: "USD", fx: "10800.0000", was_converted: true });
    // changing money at the rate you chose cannot make you richer than the rate you chose
    expect(r.tb).toEqual({ dr: "928800.00", cr: "928800.00" });
  });

  it("settles a depositor at the rate agreed today, and books the difference", async () => {
    const r: Record<string, unknown> = {};
    await rollback(sql, async (tx) => {
      const { d1, c1 } = await setup(tx, "DEPF");
      await call(tx, "fn_post_deposit", { depositor_id: d1, date: "2026-04-01", fx_amount: "20000", rate: "86" });
      await call(tx, "fn_post_voucher", {
        type: "RECEIPT", date: "2026-04-02",
        lines: [{ account_code: "CASH-INR", fx_amount: "3000000", dc: "D" },
                { account_code: "CLIENT-REC", party_id: c1, fx_amount: "3000000", dc: "C" }],
      });

      // the rate has gone up since the deposit: the desk pays more rupees for the same dollars
      const up = await call(tx, "fn_post_settlement", { depositor_id: d1, date: "2026-04-10", fx_amount: "11500", rate: "87" });
      r.up = { paid: up.inr_amount, released: up.released_inr, gain: up.gain_inr, left: up.now_owed_fx };

      // and down again: the same dollars now cost less than they are carried at
      const down = await call(tx, "fn_post_settlement", { depositor_id: d1, date: "2026-04-11", fx_amount: "8500", rate: "84.50" });
      r.down = { paid: down.inr_amount, released: down.released_inr, gain: down.gain_inr, left: down.now_owed_fx };

      r.pl = await tx`
        select a.code, sum(case when l.dc = 'D' then l.inr_amount else -l.inr_amount end)::text as net
          from ex.voucher_line l join ex.account a on a.id = l.account_id
         where a.code in ('FX-LOSS', 'FX-MARGIN') group by a.code order by a.code`;
      r.owed = await tx`select fx_due::text as fx from ex.v_depositor_due where party_id = ${d1}`;
      [r.tb] = await tx`select coalesce(sum(debit_inr),0)::text as dr, coalesce(sum(credit_inr),0)::text as cr from ex.v_trial_balance`;
    });

    // 11,500 × 87 = 10,00,500 paid, against 11,500 × 86 = 9,89,000 carried → 11,500 lost,
    // which is exactly the 11,500 dollars times the one rupee the rate moved
    expect(r.up).toEqual({ paid: "1000500.00", released: "989000.00", gain: "-11500.00", left: "8500.0000" });
    // 8,500 × 84.50 = 7,18,250 paid, against 8,500 × 86 = 7,31,000 carried → 12,750 gained
    expect(r.down).toEqual({ paid: "718250.00", released: "731000.00", gain: "12750.00", left: "0.0000" });
    expect(r.pl).toEqual([{ code: "FX-LOSS", net: "11500.00" }, { code: "FX-MARGIN", net: "-12750.00" }]);
    // settled in full, so nothing is owed in any currency
    expect(r.owed).toEqual([]);
    // gross, not net: the loss on one settlement and the gain on the other both add a line
    expect(r.tb).toEqual({ dr: "3012750.00", cr: "3012750.00" });
  });

  it("walks one depositor's money round the loop, and closes the cycle only when every stage is done", async () => {
    const r: Record<string, unknown> = {};
    await rollback(sql, async (tx) => {
      const { d1, c1 } = await setup(tx, "CYC");
      await tx`insert into ex.company_currency (currency_code, display_order, is_active) values ('EUR', 10, true)`;
      const stage = async () => (await tx<Record<string, string>[]>`
        select status, deposited_fx::text, dealt_fx::text, unspent_fx::text, billed_inr::text, collected_inr::text,
               settled_fx::text, owed_fx::text, earned_inr::text
          from ex.v_depositor_cycle where party_id = ${d1}`)[0];

      r.empty = (await stage()).status;
      await call(tx, "fn_post_deposit", { depositor_id: d1, date: "2026-04-01", fx_amount: "10000", rate: "86" });
      r.afterDeposit = await stage();

      // deal all of it: EUR 9,200 at 95 = 8,74,000 billed, cost 8,60,000
      await tx`select ex.fn_post_deal(${tx.json({ client_id: c1, date: "2026-04-02", fx_currency: "EUR", fx_amount: "9200",
                                                 fx_to_inr_rate: "95", src_amount: "10000" } as never)})`;
      r.afterDeal = await stage();

      // the client pays in two parts; receipts settle the oldest bill first
      await tx`select ex.fn_post_receipt(${tx.json({ client_id: c1, date: "2026-04-03", inr_amount: "400000" } as never)})`;
      r.partPaid = await stage();
      await tx`select ex.fn_post_receipt(${tx.json({ client_id: c1, date: "2026-04-04", inr_amount: "474000" } as never)})`;
      r.fullyPaid = await stage();

      // and the depositor is settled, all of it, at the carrying rate
      await call(tx, "fn_post_settlement", { depositor_id: d1, date: "2026-04-05", fx_amount: "10000", rate: "86" });
      r.closed = await stage();
    });

    expect(r.empty).toBe("EMPTY");
    expect(r.afterDeposit).toMatchObject({ status: "OPEN", deposited_fx: "10000.0000", unspent_fx: "10000.0000", billed_inr: "0" });
    expect(r.afterDeal).toMatchObject({ status: "OPEN", dealt_fx: "10000.0000", unspent_fx: "0.0000", billed_inr: "874000.00", collected_inr: "0.00" });
    // 4,00,000 of the 8,74,000 bill has been paid — FIFO, and there is only one bill
    expect(r.partPaid).toMatchObject({ status: "OPEN", collected_inr: "400000.00" });
    expect(r.fullyPaid).toMatchObject({ status: "OPEN", collected_inr: "874000.00", owed_fx: "10000.0000" });
    // every stage run its course: nothing unspent, nothing uncollected, nothing owed — and the
    // margin is what the desk made out of this depositor
    expect(r.closed).toMatchObject({ status: "CLOSED", settled_fx: "10000.0000", owed_fx: "0", earned_inr: "14000.00" });
  });

  it("never records the same deposit twice when the app retries", async () => {
    const r: Record<string, unknown> = {};
    await rollback(sql, async (tx) => {
      const { d1 } = await setup(tx, "DEPI");
      const p = { depositor_id: d1, date: "2026-04-01", fx_amount: "2500", rate: "86.25", client_ref: "phone-42" };
      const a = await call(tx, "fn_post_deposit", p);
      const b = await call(tx, "fn_post_deposit", p);
      r.a = { no: a.voucher_no, dup: a.duplicate, id: a.id };
      r.b = { no: b.voucher_no, dup: b.duplicate, id: b.id };
      [r.counts] = await tx`select (select count(*)::int from ex.deposit) d, (select count(*)::int from ex.voucher) v`;
    });
    expect((r.a as Record<string, unknown>).dup).toBe(false);
    expect((r.b as Record<string, unknown>).dup).toBe(true);
    expect((r.a as Record<string, unknown>).id).toBe((r.b as Record<string, unknown>).id);
    expect(r.counts).toEqual({ d: 1, v: 1 });
  });
});
