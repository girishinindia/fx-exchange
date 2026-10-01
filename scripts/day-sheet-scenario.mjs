#!/usr/bin/env node
/**
 * LOCAL ONLY. The day-sheet test (docs/testing/day-sheet-test.pdf) run through the real business
 * functions, so every figure the tester is told to expect is what the screen will actually show.
 *
 *   node scripts/day-sheet-scenario.mjs --db <admin URL>
 *
 * One company, one day, every part of the new layout: buy and keep, buy and change, sell from the
 * currency's own stock, sell funded with the dealing currency, walk-in, the two rupee drawers,
 * settle now or later, an expense, a drawer-to-bank move, the two to-do follow-ups, the day close
 * and a reversal. Output: docs/testing/day-sheet-run.txt.
 */
import { hash } from "@node-rs/argon2";
import { writeFileSync } from "node:fs";
import postgres from "postgres";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DB = opt("--db", process.env.DATABASE_ADMIN_URL);
if (!DB) { console.error("--db <admin URL> is required"); process.exit(2); }
if (/supabase\.(co|com)/.test(DB)) { console.error("Refusing to run the scenario against Supabase"); process.exit(2); }

const sql = postgres(DB, { prepare: false, max: 1, onnotice: () => {} });
const money = (n) => Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = money;

const CODE = "C009";
// The tester does this in one sitting, today. A reversal is always dated today, so the scenario
// has to use the real day too or the reversal would land on a different row of the board.
const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const DAY = iso(today);
const YESTERDAY = iso(new Date(today.getTime() - 86400000));
const OPENING = "200000";

const out = [];
const log = (s = "") => out.push(s);
const head = (t) => log(`\n${"=".repeat(78)}\n${t}\n${"=".repeat(78)}`);
const sub = (t) => log(`\n--- ${t} ${"-".repeat(Math.max(0, 70 - t.length))}`);

// ------------------------------------------------------------------ the company
await sql.begin(async (tx) => {
  await tx`set local session_replication_role = replica`;
  const [row] = await tx`select id from ex.company where code = ${CODE}`;
  if (row) {
    for (const t of ["deal_funding", "deal", "deposit", "voucher_line", "voucher", "voucher_series",
                     "fy_period", "account", "party", "user_role", "app_user", "role_permission",
                     "role", "company_currency", "login_history", "backup_log", "audit_log"]) {
      await tx`delete from ex.${tx(t)} where company_id = ${row.id}`;
    }
    await tx`delete from ex.company where id = ${row.id}`;
  }
});

const pwHash = await hash("Test-Desk-2026", { memoryCost: 19456, timeCost: 2, parallelism: 1 });
let cid, admin;
await sql.begin(async (tx) => {
  await tx`set local role ex_security`;
  [{ cid }] = await tx`select (ex.fn_register_company(${CODE}, 'Day Sheet Test', 'Test Admin', 'admin@daysheet.test', ${pwHash}, 'INR', 'USD')->>'company_id')::bigint as cid`;
  await tx`set local role ex_app`;
  await tx`select set_config('app.company_id', ${String(cid)}, true)`;
  [{ admin }] = await tx`select id as admin from ex.app_user where user_type = 'ADMIN'`;
  await tx`select set_config('app.user_id', ${String(admin)}, true)`;
  await tx`select ex.fn_complete_company_setup(${tx.json({ legal_name: "Day Sheet Test Forex", display_name: "Day Sheet Test", primary_currency: "USD", city: "Surat" })})`;
  await tx`insert into ex.company_currency (currency_code) select unnest(array['EUR','AED'])`;
});

const t = (fn) => sql.begin(async (tx) => {
  await tx`set local role ex_app`;
  await tx`select set_config('app.company_id', ${String(cid)}, true)`;
  await tx`select set_config('app.user_id', ${String(admin)}, true)`;
  return fn(tx);
});
const call = (name, payload) => t(async (tx) => (await tx`select ex.${tx(name)}(${tx.json(payload)}) as r`)[0].r);
const tryCall = async (name, payload) => {
  try { return { ok: true, r: await call(name, payload) }; }
  catch (e) { return { ok: false, message: String(e.message || e).replace(/^error: /, "") }; }
};

// parties: one named depositor, one named client, and the built-in walk-in
const party = {};
await t(async (tx) => {
  const mk = async (code, name, phone, dep, cli) => {
    const [r] = await tx`insert into ex.party (party_code, full_name, phone, is_depositor, is_client)
                         values (${code}, ${name}, ${phone}, ${dep}, ${cli}) returning id, party_code, full_name`;
    party[name] = r;
  };
  await mk("P-00001", "Mehta Exports", "9876500011", true, false);
  await mk("P-00002", "Divya Travels", "9876500021", false, true);
  await mk("WALK-IN", "Walk-in", null, true, true);
});

head("DAY SHEET TEST — THE COMPANY");
log(`  company ${CODE}  Day Sheet Test   books in INR, deals in USD   currencies USD, EUR, AED`);
log(`  depositor  P-00001  Mehta Exports`);
log(`  client     P-00002  Divya Travels`);
log(`  both       WALK-IN  Walk-in  (made by the software the first time Entry is opened)`);

const ob = await call("fn_post_voucher", {
  type: "OPENING", date: YESTERDAY, narration: "Opening balance",
  lines: [{ account_code: "CASH-INR", fx_amount: OPENING, dc: "D" }, { account_code: "OB-EQUITY", fx_amount: OPENING, dc: "C" }],
});
sub(`yesterday — ${YESTERDAY}`);
log(`  ${ob.voucher_no}  opening balance Rs ${money(OPENING)} into Cash — INR`);
log(`  the board for ${YESTERDAY} closes at Rs ${money(OPENING)} in Cash — that is today's opening row`);

// ------------------------------------------------------------------ the day
head(`THE DAY — ${DAY}`);
const V = {};

V.dep1 = await call("fn_post_deposit", { depositor_id: party["Mehta Exports"].id, date: DAY, currency: "USD", fx_amount: "1000", rate: "86.00", reference_no: "SWIFT-DS-1" });
log(`  1  BUY  later    Mehta Exports  USD 1,000 @ 86.00            ${V.dep1.voucher_no}  worth Rs ${money(V.dep1.inr_amount)}  (not paid — waits on the to-do list)`);

V.dep2 = await call("fn_post_deposit", { depositor_id: party["Walk-in"].id, date: DAY, currency: "EUR", fx_amount: "500", rate: "90.00", keep: true });
V.set2 = await call("fn_post_settlement", { depositor_id: party["Walk-in"].id, date: DAY, currency: "EUR", fx_amount: "500", rate: "90.00", account_code: "CASH-INR" });
log(`  2  BUY  kept     Walk-in        EUR 500 @ 90.00, paid now    ${V.dep2.voucher_no} + ${V.set2.voucher_no}  Rs ${money(V.set2.inr_amount)} out of Cash`);
log(`        kept = ${V.dep2.kept}, held in ${V.dep2.currency} — nothing was changed into USD`);

V.deal1 = await call("fn_post_deal", { client_id: party["Walk-in"].id, date: DAY, fx_currency: "USD", fx_amount: "400", fx_to_inr_rate: "87.00" });
V.pay1 = await call("fn_post_payout", { client_id: party["Walk-in"].id, date: DAY, currency: "USD", fx_amount: "400" });
V.rct1 = await call("fn_post_receipt", { client_id: party["Walk-in"].id, date: DAY, inr_amount: V.deal1.billed_inr, account_code: "BANK-INR" });
log(`  3  SELL own USD  Walk-in        USD 400 @ 87.00, all settled ${V.deal1.voucher_no} + ${V.pay1.voucher_no} + ${V.rct1.voucher_no}`);
log(`        funded from ${V.deal1.src_currency} ${qty(V.deal1.src_amount)} · cost Rs ${money(V.deal1.src_cost_inr)} · billed Rs ${money(V.deal1.billed_inr)} · margin Rs ${money(V.deal1.margin_inr)} · Rs into Bank`);

V.deal2 = await call("fn_post_deal", { client_id: party["Divya Travels"].id, date: DAY, fx_currency: "EUR", fx_amount: "200", fx_to_inr_rate: "92.00" });
V.pay2 = await call("fn_post_payout", { client_id: party["Divya Travels"].id, date: DAY, currency: "EUR", fx_amount: "200" });
log(`  4  SELL own EUR  Divya Travels  EUR 200 @ 92.00, ₹ later     ${V.deal2.voucher_no} + ${V.pay2.voucher_no}`);
log(`        funded from ${V.deal2.src_currency} ${qty(V.deal2.src_amount)} · cost Rs ${money(V.deal2.src_cost_inr)} · billed Rs ${money(V.deal2.billed_inr)} · margin Rs ${money(V.deal2.margin_inr)} · she owes Rs ${money(V.deal2.billed_inr)}`);

V.deal3 = await call("fn_post_deal", { client_id: party["Walk-in"].id, date: DAY, fx_currency: "AED", fx_amount: "1000", fx_to_inr_rate: "24.60", src_currency: "USD", src_amount: "285" });
V.pay3 = await call("fn_post_payout", { client_id: party["Walk-in"].id, date: DAY, currency: "AED", fx_amount: "1000" });
V.rct3 = await call("fn_post_receipt", { client_id: party["Walk-in"].id, date: DAY, inr_amount: V.deal3.billed_inr, account_code: "CASH-INR" });
log(`  5  SELL with USD Walk-in        AED 1,000 @ 24.60, settled   ${V.deal3.voucher_no} + ${V.pay3.voucher_no} + ${V.rct3.voucher_no}`);
log(`        funded from ${V.deal3.src_currency} ${qty(V.deal3.src_amount)} · cost Rs ${money(V.deal3.src_cost_inr)} · billed Rs ${money(V.deal3.billed_inr)} · margin Rs ${money(V.deal3.margin_inr)} · Rs into Cash`);

V.exp = await call("fn_post_voucher", {
  type: "EXPENSE", date: DAY, narration: "NEFT charges",
  lines: [{ account_code: "BANK-CHG", currency: "INR", fx_amount: "500", rate: 1, inr_amount: "500", dc: "D" },
          { account_code: "CASH-INR", currency: "INR", fx_amount: "500", rate: 1, inr_amount: "500", dc: "C" }],
});
log(`  6  EXPENSE       Bank & Transfer Charges Rs 500 from Cash    ${V.exp.voucher_no}`);

V.jv = await call("fn_post_voucher", {
  type: "JOURNAL", date: DAY, narration: "Drawer to bank",
  lines: [{ account_code: "BANK-INR", currency: "INR", fx_amount: "50000", rate: 1, inr_amount: "50000", dc: "D" },
          { account_code: "CASH-INR", currency: "INR", fx_amount: "50000", rate: 1, inr_amount: "50000", dc: "C" }],
});
log(`  7  CASH⇄BANK     Rs 50,000 Cash → Bank                       ${V.jv.voucher_no}`);

// ------------------------------------------------------------------ the to-do list, before
const todo = async () => {
  const hand = await t((tx) => tx`select d.full_name, trim(d.currency_code) as cur, d.fx_due, d.inr_value from ex.v_currency_due d where d.fx_due > 0 order by 1`);
  const coll = await t((tx) => tx`select b.full_name, sum(b.balance_inr) as inr from ex.v_party_balance b where b.account_group = 'RECEIVABLE' group by 1 having sum(b.balance_inr) > 0 order by 1`);
  const pay = await t((tx) => tx`select d.full_name, trim(d.currency_code) as cur, d.fx_due, d.inr_value from ex.v_depositor_due d where d.fx_due > 0 order by 1`);
  for (const h of hand) log(`  HAND OVER  ${h.full_name.padEnd(15)} ${h.cur} ${qty(h.fx_due)}  worth Rs ${money(h.inr_value)}`);
  for (const c of coll) log(`  COLLECT    ${c.full_name.padEnd(15)} Rs ${money(c.inr)}`);
  for (const p of pay) log(`  PAY        ${p.full_name.padEnd(15)} ${p.cur} ${qty(p.fx_due)}  carried at Rs ${money(p.inr_value)} (${Number(p.inr_value / p.fx_due).toFixed(2)} a ${p.cur})`);
  if (!hand.length && !coll.length && !pay.length) log(`  nothing open`);
};
sub("the to-do list on Home, after seven lines");
await todo();

V.rct4 = await call("fn_post_receipt", { client_id: party["Divya Travels"].id, date: DAY, inr_amount: "18400", account_code: "CASH-INR" });
log(`\n  8  COLLECT       Divya Travels Rs 18,400 into Cash          ${V.rct4.voucher_no}  still owed Rs ${money(V.rct4.now_owed)}`);

V.set9 = await call("fn_post_settlement", { depositor_id: party["Mehta Exports"].id, date: DAY, currency: "USD", fx_amount: "1000", rate: "85.80", account_code: "CASH-INR" });
log(`  9  PAY           Mehta Exports USD 1,000 @ 85.80 from Cash   ${V.set9.voucher_no}  Rs ${money(V.set9.inr_amount)} out`);
log(`        released Rs ${money(V.set9.released_inr)} carried at ${Number(V.set9.carried_at).toFixed(2)} · gain Rs ${money(V.set9.gain_inr)} to FX Margin · still owed ${qty(V.set9.now_owed_fx)}`);

sub("the to-do list after the two follow-ups");
await todo();

// ------------------------------------------------------------------ the board
const board = async (date) => {
  const cols = await t((tx) => tx`
    select a.id, a.code, a.name, trim(a.currency_code) as cur,
           (trim(a.currency_code) = (select trim(base_currency_code) from ex.company)) as is_base
      from ex.account a where a.account_group = 'CASH_BANK' and a.is_active
     order by (trim(a.currency_code) = (select trim(base_currency_code) from ex.company)) desc, a.sort_order, a.code`);
  const bal = async (where) => t((tx) => tx`
    select l.account_id,
           sum(case when l.dc = 'D' then l.fx_amount else -l.fx_amount end) as fx,
           sum(case when l.dc = 'D' then l.inr_amount else -l.inr_amount end) as inr
      from ex.voucher_line l join ex.voucher v on v.id = l.voucher_id
      join ex.account a on a.id = l.account_id and a.account_group = 'CASH_BANK'
     where ${where(tx)} group by l.account_id`);
  const open = await bal((tx) => tx`v.voucher_date < ${date}`);
  const rows = await t((tx) => tx`
    select v.id, v.voucher_no, v.voucher_type, v.status, p.full_name as party
      from ex.voucher v left join ex.party p on p.id = v.party_id
     where v.voucher_date = ${date} order by v.id`);
  const cells = await t((tx) => tx`
    select l.voucher_id, l.account_id,
           sum(case when l.dc = 'D' then l.fx_amount else -l.fx_amount end) as fx,
           sum(case when l.dc = 'D' then l.inr_amount else -l.inr_amount end) as inr
      from ex.voucher_line l join ex.voucher v on v.id = l.voucher_id
      join ex.account a on a.id = l.account_id and a.account_group = 'CASH_BANK'
     where v.voucher_date = ${date} group by l.voucher_id, l.account_id`);
  const live = cols.filter((c) => c.is_base || open.some((o) => String(o.account_id) === String(c.id))
    || cells.some((x) => String(x.account_id) === String(c.id)));
  const val = (c, list, vid) => {
    const r = list.find((x) => String(x.account_id) === String(c.id) && (vid === undefined || String(x.voucher_id) === String(vid)));
    return r ? Number(c.is_base ? r.inr : r.fx) : 0;
  };
  const w = 13;
  const show = (c, n) => (Math.abs(n) < 0.000001 ? "·" : (n < 0 ? "−" : "") + money(Math.abs(n))).padStart(w);
  const label = (c) => (c.is_base ? "₹ " + c.name.replace(/ — .*$/, "") : c.cur).padStart(w);

  log(`  ${"".padEnd(26)}${live.map(label).join("")}`);
  log(`  ${"Opening".padEnd(26)}${live.map((c) => show(c, val(c, open))).join("")}`);
  let inflow = live.map(() => 0), outflow = live.map(() => 0);
  for (const r of rows) {
    const line = { OPENING: "Opening", DEPOSIT: "Buy", DEAL: "Sell", PAYOUT: "Handed over", RECEIPT: "Received",
                   SETTLEMENT: "Paid", EXPENSE: "Expense", JOURNAL: "Cash⇄Bank", REVERSAL: "Reversed", REVALUATION: "Restated" }[r.voucher_type];
    const cs = live.map((c) => val(c, cells, r.id));
    cs.forEach((n, i) => { if (n >= 0) inflow[i] += n; else outflow[i] += n; });
    log(`  ${(line + " · " + (r.party ?? "—")).slice(0, 26).padEnd(26)}${live.map((c, i) => show(c, cs[i])).join("")}   ${r.voucher_no.split("/").slice(-2).join("/")}${r.status === "REVERSED" ? "  (reversed)" : ""}`);
  }
  log(`  ${"In today".padEnd(26)}${live.map((c, i) => show(c, inflow[i])).join("")}`);
  log(`  ${"Out today".padEnd(26)}${live.map((c, i) => show(c, outflow[i])).join("")}`);
  const closing = live.map((c, i) => val(c, open) + inflow[i] + outflow[i]);
  log(`  ${"CLOSING".padEnd(26)}${live.map((c, i) => show(c, closing[i])).join("")}`);
  return { live, closing };
};

sub(`the board for ${DAY}`);
const b1 = await board(DAY);

// ------------------------------------------------------------------ day close
const dayClose = async (date, rates) => {
  const held = await t((tx) => tx`
    select trim(l.currency_code) as cur,
           sum(case when l.dc = 'D' then l.fx_amount else -l.fx_amount end) as fx,
           sum(case when l.dc = 'D' then l.inr_amount else -l.inr_amount end) as inr
      from ex.voucher_line l join ex.voucher v on v.id = l.voucher_id join ex.account a on a.id = l.account_id
     where a.account_group = 'CASH_BANK' and v.voucher_date <= ${date} and trim(l.currency_code) <> 'INR'
     group by 1 having sum(case when l.dc = 'D' then l.fx_amount else -l.fx_amount end) <> 0 order by 1`);
  const rupees = await t((tx) => tx`
    select a.code, a.name,
           sum(case when l.dc = 'D' then l.inr_amount else -l.inr_amount end) as inr
      from ex.voucher_line l join ex.voucher v on v.id = l.voucher_id join ex.account a on a.id = l.account_id
     where a.account_group = 'CASH_BANK' and trim(a.currency_code) = 'INR' and v.voucher_date <= ${date}
     group by a.code, a.name, a.sort_order order by a.sort_order`);
  const [pl] = await t((tx) => tx`
    select coalesce(sum(case when a.code in ('FX-MARGIN','FX-LOSS') then (case when l.dc = 'C' then l.inr_amount else -l.inr_amount end) end), 0) as margin,
           coalesce(sum(case when a.account_type = 'EXPENSE' and a.code not in ('FX-LOSS') then (case when l.dc = 'D' then l.inr_amount else -l.inr_amount end) end), 0) as expenses
      from ex.voucher_line l join ex.voucher v on v.id = l.voucher_id join ex.account a on a.id = l.account_id
     where v.voucher_date = ${date} and a.account_type in ('INCOME','EXPENSE')`);
  let carried = 0, value = 0;
  for (const h of held) {
    const r = rates[h.cur];
    carried += Number(h.inr); value += Number(h.fx) * r;
    log(`  ${h.cur}  held ${qty(h.fx).padStart(10)}  carried Rs ${money(h.inr).padStart(11)} (@ ${(h.inr / h.fx).toFixed(2)})  × ${r.toFixed(2)} = Rs ${money(Number(h.fx) * r).padStart(11)}`);
  }
  let rup = 0;
  for (const r of rupees) { rup += Number(r.inr); log(`  ₹ ${r.name.replace(/ — .*$/, "").padEnd(6)}${"".padEnd(6)}${money(r.inr).padStart(25)}${"".padEnd(11)}   Rs ${money(r.inr).padStart(11)}`); }
  log(`  everything at close, as carried  Rs ${money(carried + rup)}      at these rates  Rs ${money(value + rup)}   (rate move Rs ${money(value - carried)}, unrealised)`);
  log(`  today's result: margin Rs ${money(pl.margin)} − expenses Rs ${money(pl.expenses)} = Rs ${money(Number(pl.margin) - Number(pl.expenses))}`);
  return { carried: carried + rup, result: Number(pl.margin) - Number(pl.expenses) };
};
sub("day close — closing rates USD 86.50, EUR 90.50");
const dc1 = await dayClose(DAY, { USD: 86.5, EUR: 90.5 });
log(`  check: opening capital Rs ${money(OPENING)} + today's result Rs ${money(dc1.result)} = Rs ${money(dc1.carried)}  ${Number(OPENING) + dc1.result === dc1.carried ? "AGREES" : "DOES NOT AGREE"}`);

// ------------------------------------------------------------------ refusals
sub("what the desk must refuse");
const r1 = await tryCall("fn_post_deal", { client_id: party["Divya Travels"].id, date: DAY, fx_currency: "EUR", fx_amount: "5000", fx_to_inr_rate: "92" });
log(`  selling more EUR than is in stock   -> ${r1.ok ? "POSTED (WRONG)" : r1.message}`);
const r2 = await tryCall("fn_post_deal", { client_id: party["Divya Travels"].id, date: DAY, fx_currency: "INR", fx_amount: "100", fx_to_inr_rate: "1" });
log(`  a deal in rupees                    -> ${r2.ok ? "POSTED (WRONG)" : r2.message}`);
const r3 = await tryCall("fn_post_settlement", { depositor_id: party["Mehta Exports"].id, date: DAY, currency: "USD", fx_amount: "100", rate: "86" });
log(`  paying a depositor who is settled    -> ${r3.ok ? "POSTED (WRONG)" : r3.message}`);

// ------------------------------------------------------------------ reverse the expense
sub("reversing the expense");
const rev = await t(async (tx) => (await tx`select ex.fn_reverse_voucher(${V.exp.id}::bigint, ${"Charged to the wrong day"}) as r`)[0].r);
log(`  ${rev.voucher_no}  cancels ${rev.reversed} — reason: ${rev.reason}`);
const b2 = await board(DAY);
const dc2 = await dayClose(DAY, { USD: 86.5, EUR: 90.5 });
log(`  check: opening capital Rs ${money(OPENING)} + today's result Rs ${money(dc2.result)} = Rs ${money(dc2.carried)}  ${Number(OPENING) + dc2.result === dc2.carried ? "AGREES" : "DOES NOT AGREE"}`);

// ------------------------------------------------------------------ the books agree
sub("do the books agree");
const [tb] = await t((tx) => tx`select coalesce(sum(debit_inr),0) as dr, coalesce(sum(credit_inr),0) as cr from ex.v_trial_balance`);
log(`  trial balance  Dr Rs ${money(tb.dr)}  =  Cr Rs ${money(tb.cr)}   ${Number(tb.dr) === Number(tb.cr) ? "AGREES" : "DOES NOT AGREE"}`);
const [vc] = await t((tx) => tx`select count(*)::int as n from ex.voucher where voucher_date = ${DAY}`);
log(`  ${vc.n} vouchers on the board for ${DAY}`);

const file = new URL("../docs/testing/day-sheet-run.txt", import.meta.url).pathname;
writeFileSync(file, out.join("\n") + "\n");
console.log(out.join("\n"));
console.log(`\nDay Sheet Test: ${vc.n} vouchers, day's result Rs ${money(dc2.result)}, trial balance ${Number(tb.dr) === Number(tb.cr) ? "agrees" : "DOES NOT AGREE"} -> ${file}`);
await sql.end();
