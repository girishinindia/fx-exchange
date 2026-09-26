/**
 * The whole cycle, end to end, against a real database (always rolled back).
 * Depositor brings USD → deal turns it into EUR for a client → the euros are handed over in
 * parts → the rupees come in in parts → the depositor is settled. When it is all done every
 * party account is flat and the only thing left is the company's own margin.
 *   DATABASE_ADMIN_URL — admin connection. Skipped when not set.
 */
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const ADMIN = process.env.DATABASE_ADMIN_URL;
class Rollback extends Error {}
type Tx = postgres.TransactionSql;
type Fn = "fn_post_deposit" | "fn_post_deal" | "fn_post_payout" | "fn_post_receipt" | "fn_post_settlement";

const call = async (tx: Tx, fn: Fn, p: Record<string, unknown>) => {
  const [r] = await tx<{ v: Record<string, string | boolean> }[]>`select ex.${tx(fn)}(${tx.json(p as never)}) as v`;
  return r.v;
};

async function setup(tx: Tx, code: string) {
  await tx`set local role ex_security`;
  const [{ cid }] = await tx`select (ex.fn_register_company(${code} || '_' || txid_current(), 'Cycle Test', 'Admin', ${code + "@test.invalid"}, 'x', 'INR', 'USD')->>'company_id')::bigint as cid`;
  await tx`set local role ex_app`;
  await tx`select set_config('app.company_id', ${String(cid)}, true)`;
  const [{ admin }] = await tx`select id as admin from ex.app_user where user_type = 'ADMIN'`;
  await tx`select set_config('app.user_id', ${String(admin)}, true)`;
  await tx`insert into ex.company_currency (currency_code) values ('EUR')`;
  const [{ d1 }] = await tx`insert into ex.party (party_code, full_name, is_depositor) values ('D1', 'Rajesh Traders', true) returning id as d1`;
  const [{ c1 }] = await tx`insert into ex.party (party_code, full_name, is_client) values ('C1', 'Kumar Overseas', true) returning id as c1`;
  return { d1, c1 };
}

const rollback = async (sql: postgres.Sql, body: (tx: Tx) => Promise<void>) => {
  try {
    await sql.begin(async (tx) => { await body(tx); throw new Rollback(); });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
};

describe.skipIf(!ADMIN)("the full cycle", () => {
  const sql = postgres(ADMIN ?? "", { prepare: false, max: 1, onnotice: () => {} });
  afterAll(() => sql.end());

  it("closes to nothing but the margin, paying in parts the whole way", async () => {
    const r: Record<string, unknown> = {};
    await rollback(sql, async (tx) => {
      const { d1, c1 } = await setup(tx, "CYC");

      await call(tx, "fn_post_deposit", { depositor_id: d1, date: "2026-04-01", fx_amount: "10000", rate: "86" });
      await call(tx, "fn_post_deal", {
        client_id: c1, date: "2026-04-02", fx_currency: "EUR", fx_amount: "9200",
        fx_to_inr_rate: "95", src_amount: "10000",
      });

      // half the euros now…
      const p1 = await call(tx, "fn_post_payout", { client_id: c1, date: "2026-04-03", currency: "EUR", fx_amount: "5000" });
      r.payout1 = { no: p1.voucher_no, wasDue: p1.was_due_fx, nowDue: p1.now_due_fx, released: p1.released_inr };
      // …part of the rupees…
      const r1 = await call(tx, "fn_post_receipt", { client_id: c1, date: "2026-04-04", inr_amount: "400000" });
      r.receipt1 = { no: r1.voucher_no, wasOwed: r1.was_owed, nowOwed: r1.now_owed, advance: r1.advance_inr };
      // …part of the depositor…
      // settled at the rate the promise is carried at, so this test keeps measuring what it is
      // for — that the cycle closes to the margin — and not the gain or loss on a moved rate,
      // which deposits.test.ts covers on its own
      await call(tx, "fn_post_settlement", { depositor_id: d1, date: "2026-04-05", fx_amount: "4000", rate: "86" });

      [r.midway] = await tx`
        select receivable_inr::text as owes_us, currency_payable_inr::text as we_owe
          from ex.v_client_position where party_id = ${c1}`;
      r.midwayCover = await tx`
        select trim(currency_code) as cur, balance_fx::text as held from ex.v_currency_position where balance_fx <> 0 order by 1`;

      // …then the rest of everything
      await call(tx, "fn_post_payout", { client_id: c1, date: "2026-04-06", currency: "EUR", fx_amount: "4200" });
      await call(tx, "fn_post_receipt", { client_id: c1, date: "2026-04-07", inr_amount: "474000" });
      await call(tx, "fn_post_settlement", { depositor_id: d1, date: "2026-04-08", fx_amount: "6000", rate: "86" });

      r.end = await tx`select code, debit_inr::text as dr, credit_inr::text as cr from ex.v_trial_balance order by code`;
      [r.endClient] = await tx`
        select receivable_inr::text as owes_us, currency_payable_inr::text as we_owe,
               billed_inr::text as billed, received_inr::text as received,
               promised_inr::text as promised, delivered_inr::text as delivered
          from ex.v_client_position where party_id = ${c1}`;
      [r.endDepositor] = await tx`select outstanding_inr::text as owed from ex.v_depositor_summary where party_id = ${d1}`;
      r.dueRows = await tx`select count(*)::int as n from ex.v_currency_due`;
    });

    expect(r.payout1).toEqual({ no: expect.stringContaining("/PAY/00001"), wasDue: "9200.0000", nowDue: "4200.0000", released: "475000.00" });
    expect(r.receipt1).toEqual({ no: expect.stringContaining("/RCT/00001"), wasOwed: "874000.00", nowOwed: "474000.00", advance: "0" });
    expect(r.midway).toEqual({ owes_us: "474000.00", we_owe: "399000.00" });
    // the euros still held are exactly the euros still owed — cover holds currency by currency
    expect(r.midwayCover).toEqual([{ cur: "EUR", held: "4200.0000" }, { cur: "INR", held: "56000.0000" }]);

    // at the end: no party balance anywhere, and the ₹14,000 margin sitting in cash
    expect(r.end).toEqual([
      { code: "CASH-INR", dr: "14000.00", cr: "0" },
      { code: "FX-MARGIN", dr: "0", cr: "14000.00" },
    ]);
    expect(r.endClient).toEqual({
      owes_us: "0.00", we_owe: "0.00", billed: "874000.00", received: "874000.00",
      promised: "874000.00", delivered: "874000.00",
    });
    expect(r.endDepositor).toEqual({ owed: "0.00" });
    expect(r.dueRows).toEqual([{ n: 0 }]);
  });

  it("refuses what would break either client track, and names an advance out loud", async () => {
    const errs: string[] = [];
    const r: Record<string, unknown> = {};
    await rollback(sql, async (tx) => {
      const { d1, c1 } = await setup(tx, "CYCG");
      await call(tx, "fn_post_deposit", { depositor_id: d1, date: "2026-04-01", fx_amount: "1000", rate: "86" });
      await call(tx, "fn_post_deal", {
        client_id: c1, date: "2026-04-02", fx_currency: "EUR", fx_amount: "900",
        fx_to_inr_rate: "100", src_amount: "1000",
      });

      const fail = async (fn: Fn, p: Record<string, unknown>) => {
        try {
          await tx.savepoint(async (sp) => { await call(sp as Tx, fn, p); });
          errs.push("NO ERROR");
        } catch (e) { errs.push((e as Error).message); }
      };
      await fail("fn_post_payout", { client_id: c1, currency: "EUR", fx_amount: "5000" });   // more than promised
      await fail("fn_post_payout", { client_id: c1, currency: "CHF", fx_amount: "1" });      // nothing owed in CHF
      await fail("fn_post_payout", { client_id: d1, currency: "EUR", fx_amount: "1" });      // not a client
      await fail("fn_post_receipt", { client_id: c1, inr_amount: "200000" });                // more than billed

      // taken deliberately, the extra becomes an advance and is named as one
      const adv = await call(tx, "fn_post_receipt", { client_id: c1, date: "2026-04-03", inr_amount: "100000", allow_advance: true });
      r.advance = { was: adv.was_owed, now: adv.now_owed, advance: adv.advance_inr };
      [r.position] = await tx`select receivable_inr::text as owes_us from ex.v_client_position where party_id = ${c1}`;
    });

    expect(errs[0]).toContain("We owe this client only 900.0000 EUR");
    expect(errs[1]).toContain("do not owe this client any CHF");
    expect(errs[2]).toContain("not an active client");
    expect(errs[3]).toContain("This client owes 90000.00; you are taking 200000.00");
    expect(r.advance).toEqual({ was: "90000.00", now: "-10000.00", advance: "10000.00" });
    // a negative receivable is the advance, shown as such rather than netted away
    expect(r.position).toEqual({ owes_us: "-10000.00" });
  });

  it("takes the gain when the currency leaves at a different rate from the promise", async () => {
    const r: Record<string, unknown> = {};
    await rollback(sql, async (tx) => {
      const { d1, c1 } = await setup(tx, "CYCR");
      await call(tx, "fn_post_deposit", { depositor_id: d1, date: "2026-04-01", fx_amount: "2000", rate: "86" });
      // promised to the client at ₹100 per euro
      await call(tx, "fn_post_deal", {
        client_id: c1, date: "2026-04-02", fx_currency: "EUR", fx_amount: "1000",
        fx_to_inr_rate: "100", src_amount: "1000",
      });
      // a second, cheaper lot of euros arrives, so the cash account is carried below the promise
      await call(tx, "fn_post_deal", {
        client_id: c1, date: "2026-04-03", fx_currency: "EUR", fx_amount: "1000",
        fx_to_inr_rate: "90", src_amount: "1000",
      });
      const out = await call(tx, "fn_post_payout", { client_id: c1, date: "2026-04-04", currency: "EUR", fx_amount: "2000" });
      r.gain = out.gain_inr;
      r.lines = await tx`
        select a.code, l.inr_amount::text as inr, l.dc
          from ex.voucher_line l join ex.account a on a.id = l.account_id
         where l.voucher_id = ${out.id as string} order by l.line_no`;
      [r.tb] = await tx`select coalesce(sum(debit_inr),0)::text as dr, coalesce(sum(credit_inr),0)::text as cr from ex.v_trial_balance`;
      r.leftInEur = await tx`select balance_fx::text as fx, balance_inr::text as inr from ex.v_currency_position where trim(currency_code) = 'EUR'`;
    });

    // both lots are carried at ₹95 on average, and the promise averages ₹95 too — nothing to take
    expect(r.gain).toBe("0.00");
    expect(r.lines).toEqual([
      { code: "CLIENT-CUR-PAY", inr: "190000.00", dc: "D" },
      { code: "CASH-EUR", inr: "190000.00", dc: "C" },
    ]);
    // and the euro account is empty in both dimensions, which is the point of releasing at cost
    expect(r.leftInEur).toEqual([{ fx: "0.0000", inr: "0.00" }]);
    expect((r.tb as { dr: string; cr: string }).dr).toBe((r.tb as { dr: string; cr: string }).cr);
  });
});
