/**
 * Corrections and the year end, against a real database (always rolled back).
 *
 * The subtle one is the first test. A reversal does not remove the original — it is an equal
 * and opposite entry, and the two together come to nothing. Leaving the original out of the
 * balances while counting its mirror would apply the reversal twice, which is exactly the bug
 * these tests exist to catch.
 *   DATABASE_ADMIN_URL — admin connection. Skipped when not set.
 */
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const ADMIN = process.env.DATABASE_ADMIN_URL;
class Rollback extends Error {}
type Tx = postgres.TransactionSql;
type Fn = "fn_post_deposit" | "fn_post_deal" | "fn_post_payout" | "fn_post_receipt"
        | "fn_post_settlement" | "fn_post_voucher" | "fn_revalue_currency";

const call = async (tx: Tx, fn: Fn, p: Record<string, unknown>) => {
  const [r] = await tx<{ v: Record<string, string | boolean> }[]>`select ex.${tx(fn)}(${tx.json(p as never)}) as v`;
  return r.v;
};
const reverse = async (tx: Tx, id: string | number, reason: string) => {
  const [r] = await tx<{ v: Record<string, string> }[]>`select ex.fn_reverse_voucher(${Number(id)}, ${reason}) as v`;
  return r.v;
};
const voucherId = (tx: Tx, type: string) =>
  tx<{ id: string }[]>`select id from ex.voucher where voucher_type = ${type} order by id limit 1`.then((r) => r[0].id);

async function setup(tx: Tx, code: string) {
  await tx`set local role ex_security`;
  const [{ cid }] = await tx`select (ex.fn_register_company(${code} || '_' || txid_current(), 'Year End Test', 'Admin', ${code + "@test.invalid"}, 'x', 'INR', 'USD')->>'company_id')::bigint as cid`;
  await tx`set local role ex_app`;
  await tx`select set_config('app.company_id', ${String(cid)}, true)`;
  const [{ admin }] = await tx`select id as admin from ex.app_user where user_type = 'ADMIN'`;
  await tx`select set_config('app.user_id', ${String(admin)}, true)`;
  await tx`insert into ex.company_currency (currency_code) values ('EUR')`;
  const [{ d1 }] = await tx`insert into ex.party (party_code, full_name, is_depositor) values ('D1', 'Rajesh Traders', true) returning id as d1`;
  const [{ c1 }] = await tx`insert into ex.party (party_code, full_name, is_client) values ('C1', 'Kumar Overseas', true) returning id as c1`;
  return { d1, c1 };
}

/** deposit → deal → part payout, the state most corrections are made against */
async function trading(tx: Tx, code: string) {
  const ids = await setup(tx, code);
  await call(tx, "fn_post_deposit", { depositor_id: ids.d1, date: "2026-04-01", fx_amount: "10000", rate: "86" });
  await call(tx, "fn_post_deal", {
    client_id: ids.c1, date: "2026-04-02", fx_currency: "EUR", fx_amount: "9200",
    fx_to_inr_rate: "95", src_amount: "10000",
  });
  await call(tx, "fn_post_payout", { client_id: ids.c1, date: "2026-04-03", currency: "EUR", fx_amount: "5000" });
  return ids;
}

const rollback = async (sql: postgres.Sql, body: (tx: Tx) => Promise<void>) => {
  try {
    await sql.begin(async (tx) => { await body(tx); throw new Rollback(); });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
};

describe.skipIf(!ADMIN)("corrections and the year end", () => {
  const sql = postgres(ADMIN ?? "", { prepare: false, max: 1, onnotice: () => {} });
  afterAll(() => sql.end());

  it("cancels a voucher without applying the cancellation twice", async () => {
    const r: Record<string, unknown> = {};
    await rollback(sql, async (tx) => {
      await trading(tx, "REV");
      r.before = await tx`select currency_code, fx_due::text as fx from ex.v_currency_due`;

      const out = await reverse(tx, await voucherId(tx, "PAYOUT"), "Client never collected it");
      r.done = { no: out.voucher_no, reversed: out.reversed };
      // EUR 5,000 comes back, taking it to 9,200 — not to 14,200, which is what excluding the
      // original from the balance while counting the mirror would produce
      r.after = await tx`select currency_code, fx_due::text as fx from ex.v_currency_due`;
      r.status = await tx`
        select voucher_type, status,
               (select o.voucher_no from ex.voucher o where o.id = v.reversed_by) as reversed_by_no,
               (select o.voucher_no from ex.voucher o where o.id = v.reversal_of) as reversal_of_no
          from ex.voucher v where voucher_type in ('PAYOUT', 'REVERSAL') order by v.id`;
      [r.tb] = await tx`select coalesce(sum(debit_inr),0)::text as dr, coalesce(sum(credit_inr),0)::text as cr from ex.v_trial_balance`;
    });

    expect(r.before).toEqual([{ currency_code: "EUR", fx: "4200.0000" }]);
    expect(r.after).toEqual([{ currency_code: "EUR", fx: "9200.0000" }]);
    expect(r.done).toEqual({ no: expect.stringContaining("/REV/00001"), reversed: expect.stringContaining("/PAY/00001") });
    expect(r.status).toEqual([
      { voucher_type: "PAYOUT", status: "REVERSED", reversed_by_no: expect.stringContaining("/REV/"), reversal_of_no: null },
      { voucher_type: "REVERSAL", status: "POSTED", reversed_by_no: null, reversal_of_no: expect.stringContaining("/PAY/") },
    ]);
    const tb = r.tb as { dr: string; cr: string };
    expect(tb.dr).toBe(tb.cr);
  });

  it("gives a deal's funding back, and refuses to unwind things in the wrong order", async () => {
    const errs: string[] = [];
    const r: Record<string, unknown> = {};
    await rollback(sql, async (tx) => {
      await trading(tx, "REVD");
      const fail = async (id: string | number, reason: string) => {
        try {
          await tx.savepoint(async (sp) => { await reverse(sp as Tx, id, reason); });
          errs.push("NO ERROR");
        } catch (e) { errs.push((e as Error).message); }
      };
      await fail(await voucherId(tx, "DEPOSIT"), "wrong amount");     // its currency is out on a deal
      await fail(await voucherId(tx, "DEAL"), "Rate was wrong");      // EUR 5,000 already handed over
      await fail(await voucherId(tx, "DEAL"), "  ");                  // no reason given

      // unwind in the order the money actually moved: payout, then deal, then deposit
      await reverse(tx, await voucherId(tx, "PAYOUT"), "Client never collected it");
      await reverse(tx, await voucherId(tx, "DEAL"), "Rate was wrong");
      r.deposit = await tx`select fx_allocated::text as used, fx_unallocated::text as free from ex.v_deposit_status`;
      [r.client] = await tx`select receivable_inr::text as owes, currency_payable_inr::text as owed_cur, deal_count::int as deals from ex.v_client_summary`;
      // the deal is gone from the books, so the deposit can now be taken back too
      await reverse(tx, await voucherId(tx, "DEPOSIT"), "Never actually received");
      r.tb = await tx`select code, debit_inr::text as dr, credit_inr::text as cr from ex.v_trial_balance order by code`;
      await fail(await voucherId(tx, "REVERSAL"), "changed my mind");  // a reversal is not reversed
    });

    expect(errs[0]).toContain("already paid for a deal");
    expect(errs[1]).toContain("5000.0000 EUR of this deal has already been handed to the client");
    expect(errs[2]).toContain("Say why this is being reversed");
    expect(r.deposit).toEqual([{ used: "0", free: "10000.0000" }]);
    expect(r.client).toEqual({ owes: "0.00", owed_cur: "0.00", deals: 0 });
    expect(r.tb).toEqual([]);   // everything unwound: not one open balance left
    expect(errs[3]).toContain("A reversal is not reversed");
  });

  it("closes a year, keeps entries out of it, and reopens it on the record", async () => {
    const errs: string[] = [];
    const r: Record<string, unknown> = {};
    await rollback(sql, async (tx) => {
      await trading(tx, "FY");
      const [{ fy }] = await tx<{ fy: string }[]>`select id as fy from ex.fy_period where fy_code = '2026-27'`;
      const [{ v }] = await tx<{ v: Record<string, string> }[]>`select ex.fn_lock_fy(${Number(fy)}, 'Signed off by the CA') as v`;
      r.locked = v;

      const fail = async (fn: () => Promise<unknown>) => {
        try {
          await tx.savepoint(async () => { await fn(); });
          errs.push("NO ERROR");
        } catch (e) { errs.push((e as Error).message); }
      };
      await fail(() => call(tx, "fn_post_voucher", {
        type: "JOURNAL", date: "2026-06-01",
        lines: [{ account_code: "CASH-INR", fx_amount: "100", dc: "D" }, { account_code: "OB-EQUITY", fx_amount: "100", dc: "C" }],
      }));
      await fail(async () => reverse(tx, await voucherId(tx, "PAYOUT"), "too late"));
      await fail(() => tx`select ex.fn_lock_fy(${Number(fy)}, 'again')`);
      await fail(() => tx`select ex.fn_unlock_fy(${Number(fy)}, '')`);

      const [{ u }] = await tx<{ u: Record<string, string> }[]>`select ex.fn_unlock_fy(${Number(fy)}, 'CA asked for a correction') as u`;
      r.reopened = u;
      [r.note] = await tx`select status, lock_note from ex.fy_period where id = ${Number(fy)}`;
      // and now an entry goes in again
      const back = await call(tx, "fn_post_voucher", {
        type: "JOURNAL", date: "2026-06-01",
        lines: [{ account_code: "CASH-INR", fx_amount: "100", dc: "D" }, { account_code: "OB-EQUITY", fx_amount: "100", dc: "C" }],
      });
      r.posted = back.voucher_no;
    });

    expect(r.locked).toEqual({ fy_code: "2026-27", status: "LOCKED", start_date: "2026-04-01", end_date: "2027-03-31" });
    expect(errs[0]).toContain("is closed — entries are not allowed");
    expect(errs[1]).toContain("is closed — it can no longer be reversed");
    expect(errs[2]).toContain("already closed");
    expect(errs[3]).toContain("Say why the year is being reopened");
    expect(r.reopened).toEqual({ fy_code: "2026-27", status: "OPEN" });
    expect((r.note as { lock_note: string }).lock_note).toContain("CA asked for a correction");
    expect(r.posted).toContain("/JV/");
  });

  it("restates currency at the closing rate, and finds no gain on a matched position", async () => {
    const r: Record<string, unknown> = {};
    await rollback(sql, async (tx) => {
      await trading(tx, "RVL");
      // EUR 4,200 held against EUR 4,200 promised to the client — perfectly matched
      const out = await call(tx, "fn_revalue_currency", { date: "2027-03-31", rates: [{ currency: "EUR", rate: "97" }] });
      r.matched = { gain: out.gain_inr, no: out.voucher_no };
      r.held = await tx`select trim(currency_code) as cur, balance_fx::text as fx, carrying_rate::text as rate from ex.v_currency_position where balance_fx <> 0`;
      r.owed = await tx`select currency_code, inr_value::text as inr from ex.v_currency_due`;
      [r.tb] = await tx`select coalesce(sum(debit_inr),0)::text as dr, coalesce(sum(credit_inr),0)::text as cr from ex.v_trial_balance`;
    });
    expect(r.matched).toEqual({ gain: "0.00", no: expect.stringContaining("/REVAL/00001") });
    // both sides moved to the new rate together, which is the whole point
    expect(r.held).toEqual([{ cur: "EUR", fx: "4200.0000", rate: "97.000000" }]);
    expect(r.owed).toEqual([{ currency_code: "EUR", inr: "407400.00" }]);
    const tb = r.tb as { dr: string; cr: string };
    expect(tb.dr).toBe(tb.cr);
  });

  it("takes a gain on currency the company holds beyond what it owes", async () => {
    const r: Record<string, unknown> = {};
    await rollback(sql, async (tx) => {
      const { c1 } = await trading(tx, "RVLG");
      // hand over everything, so the euros left are the company's own float
      await call(tx, "fn_post_payout", { client_id: c1, date: "2026-04-04", currency: "EUR", fx_amount: "4200" });
      await call(tx, "fn_post_voucher", {
        type: "RECEIPT", date: "2026-04-05",
        lines: [{ account_code: "CASH-INR", fx_amount: "500000", dc: "D" },
                { account_code: "CLIENT-REC", party_id: c1, fx_amount: "500000", dc: "C" }],
      });
      await call(tx, "fn_post_voucher", {
        type: "JOURNAL", date: "2026-04-06",
        lines: [{ account_code: "CASH-EUR", currency: "EUR", fx_amount: "1000", rate: "95", dc: "D" },
                { account_code: "CASH-INR", fx_amount: "95000", dc: "C" }],
      });
      const out = await call(tx, "fn_revalue_currency", { date: "2027-03-31", rates: [{ currency: "EUR", rate: "99" }] });
      r.gain = out.gain_inr;
      r.lines = await tx`
        select a.code, l.inr_amount::text as inr, l.dc, l.manual_rate::text as rate
          from ex.voucher_line l join ex.account a on a.id = l.account_id
         where l.voucher_id = ${out.id as string} order by l.line_no`;
      [r.tb] = await tx`select coalesce(sum(debit_inr),0)::text as dr, coalesce(sum(credit_inr),0)::text as cr from ex.v_trial_balance`;
    });
    // EUR 1,000 bought at 95, closing at 99 → ₹4,000 unrealised
    expect(r.gain).toBe("4000.00");
    expect(r.lines).toEqual([
      { code: "CASH-EUR", inr: "95000.00", dc: "C", rate: "95.000000" },
      { code: "CASH-EUR", inr: "99000.00", dc: "D", rate: "99.000000" },
      { code: "UNREAL-FX", inr: "4000.00", dc: "C", rate: "1.000000" },
    ]);
    const tb = r.tb as { dr: string; cr: string };
    expect(tb.dr).toBe(tb.cr);
  });

  it("keeps the financial year to April–March", async () => {
    const errs: string[] = [];
    const r: Record<string, unknown> = {};
    await rollback(sql, async (tx) => {
      await setup(tx, "FYIN");
      try {
        await tx.savepoint(async (sp) => {
          await sp`set local role ex_owner`;
          await sp`update ex.company set fiscal_year_start_month = 1`;
        });
        errs.push("NO ERROR");
      } catch (e) { errs.push((e as Error).message); }

      await call(tx, "fn_post_voucher", {
        type: "JOURNAL", date: "2027-02-15",
        lines: [{ account_code: "CASH-INR", fx_amount: "100", dc: "D" }, { account_code: "OB-EQUITY", fx_amount: "100", dc: "C" }],
      });
      await call(tx, "fn_post_voucher", {
        type: "JOURNAL", date: "2027-04-15",
        lines: [{ account_code: "CASH-INR", fx_amount: "100", dc: "D" }, { account_code: "OB-EQUITY", fx_amount: "100", dc: "C" }],
      });
      r.years = await tx`
        select fy_code, to_char(start_date, 'YYYY-MM-DD') as starts, to_char(end_date, 'YYYY-MM-DD') as ends
          from ex.fy_period order by start_date`;
    });
    expect(errs[0]).toContain("company_indian_financial_year");
    // 15 February 2027 falls in 2026-27; 15 April 2027 starts the next year
    expect(r.years).toEqual([
      { fy_code: "2026-27", starts: "2026-04-01", ends: "2027-03-31" },
      { fy_code: "2027-28", starts: "2027-04-01", ends: "2028-03-31" },
    ]);
  });
});
