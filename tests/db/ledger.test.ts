/**
 * The ledger engine against a real database (always rolled back).
 * The main test is the worked example: USD 10,000 @ 86 in, EUR 9,200 @ 95 out, partial payout,
 * partial receipt, partial settlement — and every balance the client asked to see.
 *   DATABASE_ADMIN_URL — admin connection. Skipped when not set.
 */
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const ADMIN = process.env.DATABASE_ADMIN_URL;
class Rollback extends Error {}
type Tx = postgres.TransactionSql;

type Line = { account_code: string; party_id?: number | string; currency?: string; fx_amount: string; rate?: string; dc: "D" | "C" };
const post = async (tx: Tx, type: string, date: string, lines: Line[], extra: Record<string, unknown> = {}) => {
  const [r] = await tx<{ v: { id: string; voucher_no: string; total_inr: string; duplicate: boolean } }[]>`
    select ex.fn_post_voucher(${tx.json({ type, date, lines, ...extra } as never)}) as v`;
  return r.v;
};

async function setup(tx: Tx, code: string) {
  await tx`set local role ex_security`;
  const [{ cid }] = await tx`select (ex.fn_register_company(${code} || '_' || txid_current(), 'Wholesale Test', 'Admin', ${code + "@test.invalid"}, 'x', 'INR', 'USD')->>'company_id')::bigint as cid`;
  await tx`set local role ex_app`;
  await tx`select set_config('app.company_id', ${String(cid)}, true)`;
  const [{ admin }] = await tx`select id as admin from ex.app_user where user_type = 'ADMIN'`;
  await tx`select set_config('app.user_id', ${String(admin)}, true)`;
  await tx`insert into ex.company_currency (currency_code) values ('EUR')`;
  const [{ d1 }] = await tx`insert into ex.party (party_code, full_name, is_depositor) values ('D1', 'Rajesh Traders', true) returning id as d1`;
  const [{ c1 }] = await tx`insert into ex.party (party_code, full_name, is_client) values ('C1', 'Kumar Overseas', true) returning id as c1`;
  return { cid, admin, d1, c1 };
}

describe.skipIf(!ADMIN)("double-entry ledger", () => {
  const sql = postgres(ADMIN ?? "", { prepare: false, max: 1, onnotice: () => {} });
  afterAll(() => sql.end());

  it("runs the full cycle and every balance ties out", async () => {
    const r: Record<string, unknown> = {};
    try {
      await sql.begin(async (tx) => {
        const { d1, c1 } = await setup(tx, "WH");

        // 0 · opening: the owner puts in USD 100 @ 85
        await post(tx, "OPENING", "2026-03-31", [
          { account_code: "CASH-USD", currency: "USD", fx_amount: "100", rate: "85", dc: "D" },
          { account_code: "OB-EQUITY", currency: "INR", fx_amount: "8500", rate: "1", dc: "C" },
        ]);
        // 1 · deposit: USD 10,000 @ 86 → the depositor is owed ₹8,60,000
        await post(tx, "DEPOSIT", "2026-04-01", [
          { account_code: "CASH-USD", currency: "USD", fx_amount: "10000", rate: "86", dc: "D" },
          { account_code: "DEP-PAY", party_id: d1, currency: "INR", fx_amount: "860000", rate: "1", dc: "C" },
        ], { party_id: d1 });
        // 2 · deal: USD 10,000 → EUR 9,200 sold at ₹95 — margin ₹14,000 recognised here
        await post(tx, "DEAL", "2026-04-02", [
          { account_code: "CLIENT-REC", party_id: c1, currency: "INR", fx_amount: "874000", rate: "1", dc: "D" },
          { account_code: "CLIENT-CUR-PAY", party_id: c1, currency: "EUR", fx_amount: "9200", rate: "95", dc: "C" },
          { account_code: "CASH-EUR", currency: "EUR", fx_amount: "9200", rate: "95", dc: "D" },
          { account_code: "CASH-USD", currency: "USD", fx_amount: "10000", rate: "86", dc: "C" },
          { account_code: "FX-MARGIN", currency: "INR", fx_amount: "14000", rate: "1", dc: "C" },
        ], { party_id: c1 });
        // 3 · payout of EUR 7,000 · 4 · receipt ₹6,00,000 · 5 · settlement ₹5,00,000
        await post(tx, "PAYOUT", "2026-04-03", [
          { account_code: "CLIENT-CUR-PAY", party_id: c1, currency: "EUR", fx_amount: "7000", rate: "95", dc: "D" },
          { account_code: "CASH-EUR", currency: "EUR", fx_amount: "7000", rate: "95", dc: "C" },
        ], { party_id: c1 });
        await post(tx, "RECEIPT", "2026-04-04", [
          { account_code: "CASH-INR", currency: "INR", fx_amount: "600000", rate: "1", dc: "D" },
          { account_code: "CLIENT-REC", party_id: c1, currency: "INR", fx_amount: "600000", rate: "1", dc: "C" },
        ], { party_id: c1 });
        await post(tx, "SETTLEMENT", "2026-04-05", [
          { account_code: "DEP-PAY", party_id: d1, currency: "INR", fx_amount: "500000", rate: "1", dc: "D" },
          { account_code: "CASH-INR", currency: "INR", fx_amount: "500000", rate: "1", dc: "C" },
        ], { party_id: d1 });

        r.trial = Object.fromEntries(
          (await tx<{ code: string; debit_inr: string; credit_inr: string }[]>`
            select code, debit_inr::text, credit_inr::text from ex.v_trial_balance order by code`)
            .map((x) => [x.code, Number(x.debit_inr) ? `${x.debit_inr} Dr` : `${x.credit_inr} Cr`]),
        );
        const [tot] = await tx<{ dr: string; cr: string }[]>`select sum(debit_inr)::text as dr, sum(credit_inr)::text as cr from ex.v_trial_balance`;
        r.balanced = tot.dr === tot.cr;
        r.total = tot.dr;
        r.position = Object.fromEntries(
          (await tx<{ currency_code: string; balance_fx: string }[]>`
            select trim(currency_code) as currency_code, balance_fx::text from ex.v_currency_position where balance_fx <> 0 order by 1`)
            .map((x) => [x.currency_code, x.balance_fx]),
        );
        r.party = (await tx<{ party_code: string; account_code: string; balance_fx: string; balance_inr: string }[]>`
          select party_code, account_code, balance_fx::text, balance_inr::text from ex.v_party_balance order by party_code, account_code`);
        // per currency: what we hold must cover what we still owe clients in that currency
        r.currencyCheck = await tx<{ currency: string; held: string; owed: string }[]>`
          select trim(c.currency_code) as currency,
                 coalesce((select sum(case when l.dc = 'D' then l.fx_amount else -l.fx_amount end)
                             from ex.voucher_line l join ex.account a on a.id = l.account_id
                            where a.account_group = 'CASH_BANK' and l.currency_code = c.currency_code), 0)::text as held,
                 coalesce((select -sum(case when l.dc = 'D' then l.fx_amount else -l.fx_amount end)
                             from ex.voucher_line l join ex.account a on a.id = l.account_id
                            where a.account_group = 'CURRENCY_PAYABLE' and l.currency_code = c.currency_code), 0)::text as owed
            from ex.company_currency c where not c.is_base order by 1`;
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }

    expect(r.balanced).toBe(true);
    expect(r.total).toBe("591500.00");
    expect(r.trial).toEqual({
      "CASH-USD": "8500.00 Dr",       // the owner's opening USD 100 — the deposit was fully used
      "CASH-EUR": "209000.00 Dr",     // EUR 2,200 still in hand
      "CASH-INR": "100000.00 Dr",     // 6,00,000 collected − 5,00,000 settled
      "CLIENT-REC": "274000.00 Dr",   // the client still owes this
      "DEP-PAY": "360000.00 Cr",      // still owed to the depositor
      "CLIENT-CUR-PAY": "209000.00 Cr", // EUR 2,200 still to deliver
      "FX-MARGIN": "14000.00 Cr",     // profit booked at the deal
      "OB-EQUITY": "8500.00 Cr",
    });
    expect(r.position).toEqual({ EUR: "2200.0000", INR: "100000.0000", USD: "100.0000" });
    expect(r.party).toEqual([
      { party_code: "C1", account_code: "CLIENT-CUR-PAY", balance_fx: "-2200.0000", balance_inr: "-209000.00" },
      { party_code: "C1", account_code: "CLIENT-REC", balance_fx: "274000.0000", balance_inr: "274000.00" },
      { party_code: "D1", account_code: "DEP-PAY", balance_fx: "-360000.0000", balance_inr: "-360000.00" },
    ]);
    // EUR: 2,200 held = 2,200 owed to the client · USD: 100 held is the company's own float
    expect(r.currencyCheck).toEqual([
      { currency: "EUR", held: "2200.0000", owed: "2200.0000" },
      { currency: "USD", held: "100.0000", owed: "0" },
    ]);
  });

  it("refuses anything that would corrupt the books", async () => {
    const r: Record<string, string> = {};
    try {
      await sql.begin(async (tx) => {
        const { d1, c1 } = await setup(tx, "GUARD");
        const attempt = (run: (sp: Tx) => Promise<unknown>) => tx.savepoint(run).then(() => "ACCEPTED", (e: Error) => e.message);

        await post(tx, "OPENING", "2026-04-01", [
          { account_code: "CASH-USD", currency: "USD", fx_amount: "1000", rate: "86", dc: "D" },
          { account_code: "OB-EQUITY", currency: "INR", fx_amount: "86000", rate: "1", dc: "C" },
        ]);

        r.unbalanced = await attempt((sp) => post(sp, "JOURNAL", "2026-04-02", [
          { account_code: "BANK-CHG", currency: "INR", fx_amount: "2500", rate: "1", dc: "D" },
          { account_code: "CASH-INR", currency: "INR", fx_amount: "2000", rate: "1", dc: "C" },
        ]));
        r.negativeCash = await attempt((sp) => post(sp, "SETTLEMENT", "2026-04-02", [
          { account_code: "DEP-PAY", party_id: d1, currency: "INR", fx_amount: "1000", rate: "1", dc: "D" },
          { account_code: "CASH-INR", currency: "INR", fx_amount: "1000", rate: "1", dc: "C" },
        ]));
        r.wrongCurrencyForAccount = await attempt((sp) => post(sp, "JOURNAL", "2026-04-02", [
          { account_code: "CASH-USD", currency: "EUR", fx_amount: "10", rate: "95", dc: "D" },
          { account_code: "OB-EQUITY", currency: "INR", fx_amount: "950", rate: "1", dc: "C" },
        ]));
        r.controlAccountWithoutParty = await attempt((sp) => post(sp, "RECEIPT", "2026-04-02", [
          { account_code: "CASH-INR", currency: "INR", fx_amount: "100", rate: "1", dc: "D" },
          { account_code: "CLIENT-REC", currency: "INR", fx_amount: "100", rate: "1", dc: "C" },
        ]));
        r.depositorOnAClientAccount = await attempt((sp) => post(sp, "RECEIPT", "2026-04-02", [
          { account_code: "CASH-INR", currency: "INR", fx_amount: "100", rate: "1", dc: "D" },
          { account_code: "CLIENT-REC", party_id: d1, currency: "INR", fx_amount: "100", rate: "1", dc: "C" },
        ]));
        r.rateOnBookCurrency = await attempt((sp) => post(sp, "JOURNAL", "2026-04-02", [
          { account_code: "CASH-INR", currency: "INR", fx_amount: "100", rate: "2", dc: "D" },
          { account_code: "OB-EQUITY", currency: "INR", fx_amount: "200", rate: "1", dc: "C" },
        ]));
        r.secondOpening = await attempt((sp) => post(sp, "OPENING", "2026-04-02", [
          { account_code: "CASH-INR", currency: "INR", fx_amount: "100", rate: "1", dc: "D" },
          { account_code: "OB-EQUITY", currency: "INR", fx_amount: "100", rate: "1", dc: "C" },
        ]));
        r.oneSidedVoucher = await attempt((sp) => post(sp, "JOURNAL", "2026-04-02", [
          { account_code: "CASH-INR", currency: "INR", fx_amount: "100", rate: "1", dc: "D" },
        ]));
        r.editPostedVoucher = await attempt((sp) => sp`update ex.voucher set total_inr = 1 where voucher_type = 'OPENING'`);
        r.deletePostedLine = await attempt((sp) => sp`delete from ex.voucher_line`);
        r.changePrimaryCurrency = await attempt((sp) => sp`update ex.company set primary_currency_code = 'EUR'`);

        // and the control: a good voucher posts
        r.goodVoucher = await attempt((sp) => post(sp, "DEAL", "2026-04-02", [
          { account_code: "CLIENT-REC", party_id: c1, currency: "INR", fx_amount: "87000", rate: "1", dc: "D" },
          { account_code: "CLIENT-CUR-PAY", party_id: c1, currency: "EUR", fx_amount: "1000", rate: "87", dc: "C" },
          { account_code: "CASH-EUR", currency: "EUR", fx_amount: "1000", rate: "87", dc: "D" },
          { account_code: "CASH-USD", currency: "USD", fx_amount: "1000", rate: "86", dc: "C" },
          { account_code: "FX-MARGIN", currency: "INR", fx_amount: "1000", rate: "1", dc: "C" },
        ], { party_id: c1 }));
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }

    expect(r.unbalanced).toMatch(/does not balance/);
    expect(r.negativeCash).toMatch(/never be negative/);
    expect(r.wrongCurrencyForAccount).toMatch(/holds USD only/);
    expect(r.controlAccountWithoutParty).toMatch(/needs a party/);
    expect(r.depositorOnAClientAccount).toMatch(/not an active client/);
    expect(r.rateOnBookCurrency).toMatch(/rate for INR is always 1/);
    expect(r.secondOpening).toMatch(/posted once/);
    expect(r.oneSidedVoucher).toMatch(/at least two lines/);
    expect(r.editPostedVoucher).toMatch(/permission denied|never be edited/);
    expect(r.deletePostedLine).toMatch(/permission denied|never be deleted/);
    expect(r.changePrimaryCurrency).toMatch(/cannot be changed once vouchers exist|permission denied/);
    expect(r.goodVoucher).toBe("ACCEPTED");
  });

  it("numbers vouchers gaplessly per financial year and never posts the same client_ref twice", async () => {
    const r: Record<string, unknown> = {};
    try {
      await sql.begin(async (tx) => {
        await setup(tx, "NUM");
        const line = (dc: "D" | "C") => ({ account_code: dc === "D" ? "BANK-CHG" : "OB-EQUITY", currency: "INR", fx_amount: "100", rate: "1", dc });
        const a = await post(tx, "EXPENSE", "2026-04-10", [line("D"), line("C")]);
        const b = await post(tx, "EXPENSE", "2026-05-10", [line("D"), line("C")]);
        const c = await post(tx, "EXPENSE", "2027-04-10", [line("D"), line("C")]);   // next financial year
        const d = await post(tx, "EXPENSE", "2026-06-10", [line("D"), line("C")], { client_ref: "mobile-1" });
        const again = await post(tx, "EXPENSE", "2026-06-10", [line("D"), line("C")], { client_ref: "mobile-1" });
        r.numbers = [a.voucher_no, b.voucher_no, c.voucher_no].map((n) => n.split("/").slice(1).join("/"));
        r.idempotent = again.voucher_no === d.voucher_no && again.duplicate === true;
        r.count = (await tx`select count(*)::int as n from ex.voucher`)[0].n;
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
    expect(r.numbers).toEqual(["2026-27/EXP/00001", "2026-27/EXP/00002", "2027-28/EXP/00001"]);
    expect(r.idempotent).toBe(true);
    expect(r.count).toBe(4);
  });

  it("puts rate rounding into the Rounding Off account", async () => {
    let note = "";
    let rows: { code: string; inr: string; dc: string }[] = [];
    try {
      await sql.begin(async (tx) => {
        await setup(tx, "ROUND");
        // 3 × 33.333333 = 99.999999 → 100.00 on one side, 99.99 on the other
        const v = await post(tx, "JOURNAL", "2026-04-01", [
          { account_code: "CASH-USD", currency: "USD", fx_amount: "3", rate: "33.333333", dc: "D" },
          { account_code: "OB-EQUITY", currency: "INR", fx_amount: "99.99", rate: "1", dc: "C" },
        ]);
        note = v.voucher_no;
        rows = await tx<{ code: string; inr: string; dc: string }[]>`
          select a.code, l.inr_amount::text as inr, l.dc from ex.voucher_line l join ex.account a on a.id = l.account_id
           where l.voucher_id = ${v.id} order by l.line_no`;
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
    expect(note).toContain("/JV/");
    expect(rows).toEqual([
      { code: "CASH-USD", inr: "100.00", dc: "D" },
      { code: "OB-EQUITY", inr: "99.99", dc: "C" },
      { code: "ROUNDING", inr: "0.01", dc: "C" },
    ]);
  });
});
