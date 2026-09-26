/**
 * The statements the CA is handed, against a real database (always rolled back).
 * Two things must be true or nothing else matters: the balance sheet must balance, and the
 * profit on it must be the same profit the profit-and-loss account arrives at.
 *   DATABASE_ADMIN_URL — admin connection. Skipped when not set.
 */
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const ADMIN = process.env.DATABASE_ADMIN_URL;
class Rollback extends Error {}
type Tx = postgres.TransactionSql;
type Fn = "fn_post_deposit" | "fn_post_deal" | "fn_post_payout" | "fn_post_receipt" | "fn_post_settlement" | "fn_post_voucher";

const call = async (tx: Tx, fn: Fn, p: Record<string, unknown>) => {
  const [r] = await tx<{ v: Record<string, string | boolean> }[]>`select ex.${tx(fn)}(${tx.json(p as never)}) as v`;
  return r.v;
};

const num = (v: unknown) => Math.round(Number(v) * 100);

async function books(tx: Tx) {
  await tx`set local role ex_security`;
  const [{ cid }] = await tx`select (ex.fn_register_company('STM_' || txid_current(), 'Statement Test', 'Admin', 'stm@test.invalid', 'x', 'INR', 'USD')->>'company_id')::bigint as cid`;
  await tx`set local role ex_app`;
  await tx`select set_config('app.company_id', ${String(cid)}, true)`;
  const [{ admin }] = await tx`select id as admin from ex.app_user where user_type = 'ADMIN'`;
  await tx`select set_config('app.user_id', ${String(admin)}, true)`;
  await tx`insert into ex.company_currency (currency_code) values ('EUR')`;
  const [{ d1 }] = await tx`insert into ex.party (party_code, full_name, is_depositor) values ('D1', 'Rajesh Traders', true) returning id as d1`;
  const [{ c1 }] = await tx`insert into ex.party (party_code, full_name, is_client) values ('C1', 'Kumar Overseas', true) returning id as c1`;

  // a year of trading: capital in, a deposit, a deal at a margin, part settled both ways, one expense
  await call(tx, "fn_post_voucher", {
    type: "OPENING", date: "2026-03-31",
    lines: [{ account_code: "CASH-INR", fx_amount: "200000", dc: "D" },
            { account_code: "OB-EQUITY", fx_amount: "200000", dc: "C" }],
  });
  await call(tx, "fn_post_deposit", { depositor_id: d1, date: "2026-04-01", fx_amount: "10000", rate: "86" });
  await call(tx, "fn_post_deal", {
    client_id: c1, date: "2026-04-02", fx_currency: "EUR", fx_amount: "9200",
    fx_to_inr_rate: "95", src_amount: "10000",
  });
  await call(tx, "fn_post_payout", { client_id: c1, date: "2026-04-03", currency: "EUR", fx_amount: "5000" });
  await call(tx, "fn_post_receipt", { client_id: c1, date: "2026-04-04", inr_amount: "400000" });
  await call(tx, "fn_post_settlement", { depositor_id: d1, date: "2026-04-05", fx_amount: "4000", rate: "86" });
  await call(tx, "fn_post_voucher", {
    type: "EXPENSE", date: "2026-04-06",
    lines: [{ account_code: "BANK-CHG", fx_amount: "2500", dc: "D" },
            { account_code: "CASH-INR", fx_amount: "2500", dc: "C" }],
  });
  return { d1, c1 };
}

const rollback = async (sql: postgres.Sql, body: (tx: Tx) => Promise<void>) => {
  try {
    await sql.begin(async (tx) => { await body(tx); throw new Rollback(); });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
};

describe.skipIf(!ADMIN)("statements", () => {
  const sql = postgres(ADMIN ?? "", { prepare: false, max: 1, onnotice: () => {} });
  afterAll(() => sql.end());

  it("earns the margin, less what was spent", async () => {
    const r: Record<string, unknown> = {};
    await rollback(sql, async (tx) => {
      await books(tx);
      // the movement of income and expense over the year — what a profit and loss is made of
      r.pl = await tx`
        select a.code, a.account_type,
               coalesce(sum(case when l.dc = 'D' then l.inr_amount else -l.inr_amount end), 0)::text as movement
          from ex.account a
          join ex.voucher_line l on l.account_id = a.id
          join ex.voucher v on v.id = l.voucher_id and v.status = 'POSTED'
                           and v.voucher_date between '2026-04-01' and '2027-03-31'
         where a.account_type in ('INCOME', 'EXPENSE')
         group by a.code, a.account_type
        having coalesce(sum(case when l.dc = 'D' then l.inr_amount else -l.inr_amount end), 0) <> 0
         order by a.code`;
    });
    // ₹14,000 of deal margin, ₹2,500 of bank charges → ₹11,500 profit
    expect(r.pl).toEqual([
      { code: "BANK-CHG", account_type: "EXPENSE", movement: "2500.00" },
      { code: "FX-MARGIN", account_type: "INCOME", movement: "-14000.00" },
    ]);
  });

  it("balances: what is held equals what is owed plus what is the company's own", async () => {
    const r: Record<string, unknown> = {};
    await rollback(sql, async (tx) => {
      await books(tx);
      r.rows = await tx`
        select account_type, coalesce(sum(balance_inr), 0)::text as bal
          from ex.v_account_balance group by account_type order by account_type`;
      [r.tb] = await tx`select coalesce(sum(debit_inr),0)::text as dr, coalesce(sum(credit_inr),0)::text as cr from ex.v_trial_balance`;
    });

    const by = Object.fromEntries((r.rows as { account_type: string; bal: string }[]).map((x) => [x.account_type, num(x.bal)]));
    const assets = by.ASSET ?? 0;
    const liabilities = -(by.LIABILITY ?? 0);
    const equity = -(by.EQUITY ?? 0);
    const retained = -((by.INCOME ?? 0) + (by.EXPENSE ?? 0));

    expect(retained).toBe(1_150_000);          // ₹11,500 kept from the year
    expect(equity).toBe(20_000_000);           // ₹2,00,000 the owner put in
    expect(assets).toBe(liabilities + equity + retained);
    // and the same fact said the other way, which is the check the CA does first
    const tb = r.tb as { dr: string; cr: string };
    expect(tb.dr).toBe(tb.cr);
  });

  it("ages what is open from the entry that is still open, not from the party's net balance", async () => {
    const r: Record<string, unknown> = {};
    await rollback(sql, async (tx) => {
      const { c1 } = await books(tx);
      // a second, much later bill; the earlier receipt has already eaten into the first one
      await call(tx, "fn_post_deposit", { depositor_id: (await tx<{ id: string }[]>`select id from ex.party where party_code = 'D1'`)[0].id, date: "2026-09-01", fx_amount: "1000", rate: "87" });
      await call(tx, "fn_post_deal", {
        client_id: c1, date: "2026-09-02", fx_currency: "EUR", fx_amount: "900",
        fx_to_inr_rate: "100", src_amount: "1000",
      });
      r.open = await tx`
        select to_char(v.voucher_date, 'YYYY-MM-DD') as date, l.dc, l.inr_amount::text as inr
          from ex.voucher_line l
          join ex.voucher v on v.id = l.voucher_id and v.status = 'POSTED'
          join ex.account a on a.id = l.account_id and a.account_group = 'RECEIVABLE'
         where l.party_id = ${c1} order by v.voucher_date, v.id`;
    });
    // billed 8,74,000 in April, paid 4,00,000 in April, billed 90,000 in September:
    // FIFO leaves 4,74,000 aged from April and 90,000 from September — never one lump dated September
    expect(r.open).toEqual([
      { date: "2026-04-02", dc: "D", inr: "874000.00" },
      { date: "2026-04-04", dc: "C", inr: "400000.00" },
      { date: "2026-09-02", dc: "D", inr: "90000.00" },
    ]);
  });
});
