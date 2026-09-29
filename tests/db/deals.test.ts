/**
 * Deals against a real database (always rolled back).
 * The point of the whole product is here: a deal is allocated across the deposits that pay for
 * it, each slice at the rate that deposit actually cost, so the margin is billing minus real
 * cost and nothing else.
 *   DATABASE_ADMIN_URL — admin connection. Skipped when not set.
 */
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const ADMIN = process.env.DATABASE_ADMIN_URL;
class Rollback extends Error {}
type Tx = postgres.TransactionSql;
type Fn = "fn_post_deposit" | "fn_post_deal" | "fn_post_voucher";

const call = async (tx: Tx, fn: Fn, p: Record<string, unknown>) => {
  const [r] = await tx<{ v: Record<string, string | boolean> }[]>`select ex.${tx(fn)}(${tx.json(p as never)}) as v`;
  return r.v;
};

async function setup(tx: Tx, code: string) {
  await tx`set local role ex_security`;
  const [{ cid }] = await tx`select (ex.fn_register_company(${code} || '_' || txid_current(), 'Deal Test', 'Admin', ${code + "@test.invalid"}, 'x', 'INR', 'USD')->>'company_id')::bigint as cid`;
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

describe.skipIf(!ADMIN)("deals", () => {
  const sql = postgres(ADMIN ?? "", { prepare: false, max: 1, onnotice: () => {} });
  afterAll(() => sql.end());

  it("spends the oldest deposits first and earns the difference between the two rates", async () => {
    const r: Record<string, unknown> = {};
    await rollback(sql, async (tx) => {
      const { d1, c1 } = await setup(tx, "DEAL");
      // USD 8,000 at 86 and USD 4,000 at 85.50 — two different costs
      await call(tx, "fn_post_deposit", { depositor_id: d1, date: "2026-04-01", fx_amount: "8000", rate: "86" });
      await call(tx, "fn_post_deposit", { depositor_id: d1, date: "2026-04-02", fx_amount: "4000", rate: "85.5" });

      // the client wants EUR 9,200 at ₹95; it takes USD 10,000 to source
      const deal = await call(tx, "fn_post_deal", {
        client_id: c1, date: "2026-04-03", fx_currency: "EUR", fx_amount: "9200",
        fx_to_inr_rate: "95", src_amount: "10000", reference_no: "DEAL-1",
      });
      r.deal = { no: deal.voucher_no, billed: deal.billed_inr, cost: deal.src_cost_inr, margin: deal.margin_inr };

      r.lines = await tx`
        select a.code, trim(l.currency_code) as cur, l.fx_amount::text as fx, l.manual_rate::text as rate,
               l.inr_amount::text as inr, l.dc
          from ex.voucher_line l join ex.account a on a.id = l.account_id
         where l.voucher_id = ${deal.voucher_id as string} order by l.line_no`;

      r.funding = await tx`
        select f.fx_allocated::text as fx, f.manual_rate::text as rate, f.cost_inr::text as cost
          from ex.deal_funding f order by f.id`;

      r.left = await tx`select voucher_no, fx_unallocated::text as un from ex.v_deposit_status order by voucher_no`;
      [r.status] = await tx`
        select average_cost_rate::text as cost_rate, margin_pct::text as pct, funding_slices::int as slices,
               src_to_fx_rate::text as conv from ex.v_deal_status`;
      [r.client] = await tx`
        select deal_count::int as deals, total_billed::text as billed, receivable_inr::text as owes,
               currency_payable_inr::text as owed_currency from ex.v_client_summary where party_id = ${c1}`;
      r.due = await tx`select currency_code, fx_due::text as fx from ex.v_currency_due`;
      [r.tb] = await tx`select coalesce(sum(debit_inr),0)::text as dr, coalesce(sum(credit_inr),0)::text as cr from ex.v_trial_balance`;
    });

    // 8,000 × 86 = 6,88,000 and 2,000 × 85.50 = 1,71,000 → cost 8,59,000; billed 8,74,000; margin 15,000
    expect(r.deal).toEqual({ no: expect.stringContaining("/DEAL/00001"), billed: "874000.00", cost: "859000.00", margin: "15000.00" });
    expect(r.lines).toEqual([
      { code: "CLIENT-REC", cur: "INR", fx: "874000.0000", rate: "1.000000", inr: "874000.00", dc: "D" },
      { code: "CASH-EUR", cur: "EUR", fx: "9200.0000", rate: "95.000000", inr: "874000.00", dc: "D" },
      { code: "CLIENT-CUR-PAY", cur: "EUR", fx: "9200.0000", rate: "95.000000", inr: "874000.00", dc: "C" },
      { code: "CASH-USD", cur: "USD", fx: "8000.0000", rate: "86.000000", inr: "688000.00", dc: "C" },
      { code: "CASH-USD", cur: "USD", fx: "2000.0000", rate: "85.500000", inr: "171000.00", dc: "C" },
      { code: "FX-MARGIN", cur: "INR", fx: "15000.0000", rate: "1.000000", inr: "15000.00", dc: "C" },
    ]);
    expect(r.funding).toEqual([
      { fx: "8000.0000", rate: "86.000000", cost: "688000.00" },
      { fx: "2000.0000", rate: "85.500000", cost: "171000.00" },
    ]);
    expect(r.left).toEqual([
      { voucher_no: expect.stringContaining("/DEP/00001"), un: "0.0000" },
      { voucher_no: expect.stringContaining("/DEP/00002"), un: "2000.0000" },
    ]);
    expect(r.status).toEqual({ cost_rate: "85.900000", pct: "1.75", slices: 2, conv: "0.920000" });
    // the client owes us rupees AND we owe them euros — two debts, never netted
    expect(r.client).toEqual({ deals: 1, billed: "874000.00", owes: "874000.00", owed_currency: "874000.00" });
    expect(r.due).toEqual([{ currency_code: "EUR", fx: "9200.0000" }]);
    expect(r.tb).toEqual({ dr: "1919000.00", cr: "1919000.00" });
  });

  it("honours an allocation the desk chooses itself", async () => {
    const r: Record<string, unknown> = {};
    await rollback(sql, async (tx) => {
      const { d1, c1 } = await setup(tx, "DEALF");
      const a = await call(tx, "fn_post_deposit", { depositor_id: d1, date: "2026-04-01", fx_amount: "5000", rate: "86" });
      const b = await call(tx, "fn_post_deposit", { depositor_id: d1, date: "2026-04-02", fx_amount: "5000", rate: "84" });
      // deliberately skip the older deposit and take the cheaper one
      const deal = await call(tx, "fn_post_deal", {
        client_id: c1, date: "2026-04-03", fx_currency: "EUR", fx_amount: "1000", fx_to_inr_rate: "95",
        src_amount: "1000", funding: [{ deposit_id: b.id, fx_allocated: "1000" }],
      });
      r.margin = deal.margin_inr;
      r.cost = deal.src_cost_inr;
      r.left = await tx`
        select s.voucher_no, s.fx_unallocated::text as un from ex.v_deposit_status s order by s.voucher_no`;
      r.untouched = a.voucher_no;
    });
    // 1,000 × 84 = 84,000 cost against 1,000 × 95 = 95,000 billed
    expect(r.cost).toBe("84000.00");
    expect(r.margin).toBe("11000.00");
    expect(r.left).toEqual([
      { voucher_no: expect.stringContaining("/DEP/00001"), un: "5000.0000" },
      { voucher_no: expect.stringContaining("/DEP/00002"), un: "4000.0000" },
    ]);
  });

  it("records a deal sold below cost as a loss instead of refusing it", async () => {
    const r: Record<string, unknown> = {};
    await rollback(sql, async (tx) => {
      const { d1, c1 } = await setup(tx, "DEALL");
      await call(tx, "fn_post_deposit", { depositor_id: d1, date: "2026-04-01", fx_amount: "2000", rate: "86" });
      const deal = await call(tx, "fn_post_deal", {
        client_id: c1, date: "2026-04-02", fx_currency: "EUR", fx_amount: "1000",
        fx_to_inr_rate: "80", src_amount: "2000",
      });
      r.margin = deal.margin_inr;
      r.loss = await tx`
        select a.code, l.inr_amount::text as inr, l.dc from ex.voucher_line l join ex.account a on a.id = l.account_id
         where l.voucher_id = ${deal.voucher_id as string} and a.code in ('FX-LOSS','FX-MARGIN')`;
      [r.tb] = await tx`select coalesce(sum(debit_inr),0)::text as dr, coalesce(sum(credit_inr),0)::text as cr from ex.v_trial_balance`;
    });
    expect(r.margin).toBe("-92000.00");
    expect(r.loss).toEqual([{ code: "FX-LOSS", inr: "92000.00", dc: "D" }]);
    expect((r.tb as { dr: string; cr: string }).dr).toBe((r.tb as { dr: string; cr: string }).cr);
  });

  it("sells the dealing currency itself, and a kept currency from its own stock (0023)", async () => {
    const r: Record<string, unknown> = {};
    await rollback(sql, async (tx) => {
      const { d1, c1 } = await setup(tx, "DEALS");
      await tx`insert into ex.company_currency (currency_code) values ('EUR') on conflict do nothing`;
      await call(tx, "fn_post_deposit", { depositor_id: d1, date: "2026-04-01", fx_amount: "1000", rate: "86" });
      const kept = await call(tx, "fn_post_deposit", { depositor_id: d1, date: "2026-04-01", currency: "EUR", fx_amount: "50", rate: "90.5", keep: true });
      r.kept = kept.kept;
      r.keptCurrency = kept.currency;
      [r.owedEur] = await tx`select fx_due::text as fx, inr_value::text as inr from ex.v_depositor_due where party_id = ${d1} and currency_code = 'EUR'`;
      // no euros were changed into dollars: exactly two lines
      [r.lines] = await tx`select count(*)::int as n from ex.voucher_line where voucher_id = ${kept.voucher_id as string}`;

      // a sale of dollars, from the dollar deposit, oldest first — no src_amount needed
      const usd = await call(tx, "fn_post_deal", { client_id: c1, date: "2026-04-02", fx_currency: "USD", fx_amount: "100", fx_to_inr_rate: "84.5" });
      r.usd = { src: usd.src_currency, srcAmount: usd.src_amount, cost: usd.src_cost_inr, margin: usd.margin_inr };

      // a sale of euros comes from the kept euros by default, at what they cost
      const eur = await call(tx, "fn_post_deal", { client_id: c1, date: "2026-04-02", fx_currency: "EUR", fx_amount: "30", fx_to_inr_rate: "92" });
      r.eur = { src: eur.src_currency, cost: eur.src_cost_inr, margin: eur.margin_inr };
      // …and the euro stock is worth the same per unit before and after the deal
      [r.eurStock] = await tx`
        select sum(case when l.dc = 'D' then l.fx_amount else -l.fx_amount end)::text as fx,
               sum(case when l.dc = 'D' then l.inr_amount else -l.inr_amount end)::text as inr
          from ex.voucher_line l join ex.account a on a.id = l.account_id where a.code = 'CASH-EUR'`;
      // the client is owed 30 EUR, carried at cost
      [r.due] = await tx`select fx_due::text as fx, inr_value::text as inr from ex.v_currency_due where party_id = ${c1} and currency_code = 'EUR'`;
      // but the desk may still buy euros with dollars when it says so
      const conv = await call(tx, "fn_post_deal", { client_id: c1, date: "2026-04-02", fx_currency: "EUR", fx_amount: "10", fx_to_inr_rate: "92", src_currency: "USD", src_amount: "11" });
      r.conv = conv.src_currency;
      [r.tb] = await tx`select coalesce(sum(debit_inr),0)::text as dr, coalesce(sum(credit_inr),0)::text as cr from ex.v_trial_balance`;
    });
    expect(r.kept).toBe(true);
    expect(r.keptCurrency).toBe("EUR");
    expect(r.owedEur).toEqual({ fx: "50.0000", inr: "4525.00" });
    expect(r.lines).toEqual({ n: 2 });
    expect(r.usd).toEqual({ src: "USD", srcAmount: "100.0000", cost: "8600.00", margin: "-150.00" });
    expect(r.eur).toEqual({ src: "EUR", cost: "2715.00", margin: "45.00" });
    expect(r.eurStock).toEqual({ fx: "50.0000", inr: "4525.00" });
    expect(r.due).toEqual({ fx: "30.0000", inr: "2715.00" });
    expect(r.conv).toBe("USD");
    expect((r.tb as { dr: string; cr: string }).dr).toBe((r.tb as { dr: string; cr: string }).cr);
  });

  it("refuses a deal the deposits cannot pay for, and books the same one only once", async () => {
    const errs: string[] = [];
    const r: Record<string, unknown> = {};
    await rollback(sql, async (tx) => {
      const { d1, c1 } = await setup(tx, "DEALG");
      await call(tx, "fn_post_deposit", { depositor_id: d1, date: "2026-04-01", fx_amount: "1000", rate: "86" });
      const [{ dep }] = await tx<{ dep: string }[]>`select id as dep from ex.deposit limit 1`;

      const fail = async (p: Record<string, unknown>) => {
        try {
          await tx.savepoint(async (sp) => { await call(sp as Tx, "fn_post_deal", p); });
          errs.push("NO ERROR");
        } catch (e) { errs.push((e as Error).message); }
      };
      const base = { client_id: c1, date: "2026-04-02", fx_currency: "EUR", fx_amount: "100", fx_to_inr_rate: "95" };
      await fail({ ...base, src_amount: "5000" });                                            // more than is left
      await fail({ ...base, src_amount: "900", funding: [{ deposit_id: dep, fx_allocated: "5000" }] }); // slice too big
      await fail({ ...base, src_amount: "900", funding: [{ deposit_id: dep, fx_allocated: "500" }] });  // does not add up
      await fail({ ...base, fx_currency: "INR", src_amount: "100" });                         // the book currency
      await fail({ ...base, fx_currency: "JPY", src_amount: "100" });                         // currency not dealt in
      await fail({ ...base, client_id: d1, src_amount: "100" });                              // not a client

      const p = { ...base, src_amount: "100", client_ref: "mob-77" };
      const one = await call(tx, "fn_post_deal", p);
      const two = await call(tx, "fn_post_deal", p);
      r.same = one.id === two.id && two.duplicate === true;
      [r.counts] = await tx`select (select count(*)::int from ex.deal) d, (select count(*)::int from ex.deal_funding) f`;
    });

    expect(errs[0]).toContain("but 1000.0000 USD was allocated");
    expect(errs[1]).toContain("has only 1000.0000 USD left");
    expect(errs[2]).toContain("spends 900.0000 USD, but 500.0000 USD was allocated");
    expect(errs[3]).toContain("INR is the book currency");
    expect(errs[4]).toContain("does not deal in JPY");
    expect(errs[5]).toContain("not an active client");
    expect(r.same).toBe(true);
    expect(r.counts).toEqual({ d: 1, f: 1 });
  });
});
