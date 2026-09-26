#!/usr/bin/env node
/**
 * LOCAL ONLY. The small "Company A" walkthrough in docs/testing/company-a-testing.md, run through
 * the real business functions so every figure in that document is what the screen will show.
 *
 *   node scripts/company-a-scenario.mjs --db <admin URL>
 *
 * One depositor who deposits twice, one client who buys three currencies, and five rupee
 * payments back to the depositor that close the cycle.
 */
import { hash } from "@node-rs/argon2";
import postgres from "postgres";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DB = opt("--db", process.env.DATABASE_ADMIN_URL);
if (!DB) { console.error("--db <admin URL> is required"); process.exit(2); }
if (/supabase\.(co|com)/.test(DB)) { console.error("Refusing to run the scenario against Supabase"); process.exit(2); }

const sql = postgres(DB, { prepare: false, max: 1, onnotice: () => {} });
const money = (n) => Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fx = money;
const head = (t) => console.log(`\n${"=".repeat(78)}\n${t}\n${"=".repeat(78)}`);
const sub = (t) => console.log(`\n--- ${t} ${"-".repeat(Math.max(0, 70 - t.length))}`);

const CODE = "C002";

// ---------------------------------------------------------------- the company
await sql.begin(async (tx) => {
  await tx`set local session_replication_role = replica`;
  const [c] = await tx`select id from ex.company where code = ${CODE}`;
  if (c) {
    for (const t of ["deal_funding", "deal", "deposit", "voucher_line", "voucher", "voucher_series",
                     "fy_period", "account", "party", "user_role", "app_user", "role_permission",
                     "role", "company_currency", "login_history", "backup_log", "audit_log"]) {
      await tx`delete from ex.${tx(t)} where company_id = ${c.id}`;
    }
    await tx`delete from ex.company where id = ${c.id}`;
  }
});

const pwHash = await hash("Test-Desk-2026", { memoryCost: 19456, timeCost: 2, parallelism: 1 });
let cid, admin;
await sql.begin(async (tx) => {
  await tx`set local role ex_security`;
  [{ cid }] = await tx`select (ex.fn_register_company(${CODE}, 'Company A', 'Amit Shah',
                        'amit@company-a.test', ${pwHash}, 'INR', 'USD')->>'company_id')::bigint as cid`;
  await tx`set local role ex_app`;
  await tx`select set_config('app.company_id', ${String(cid)}, true)`;
  [{ admin }] = await tx`select id as admin from ex.app_user where user_type = 'ADMIN'`;
  await tx`select set_config('app.user_id', ${String(admin)}, true)`;
  await tx`select ex.fn_complete_company_setup(${tx.json({
    legal_name: "Company A Forex Private Limited", display_name: "Company A",
    primary_currency: "USD", city: "Surat",
  })})`;
  await tx`insert into ex.company_currency (currency_code) select unnest(array['EUR','GBP','AED'])`;
});

const t = (fn) => sql.begin(async (tx) => {
  await tx`set local role ex_app`;
  await tx`select set_config('app.company_id', ${String(cid)}, true)`;
  await tx`select set_config('app.user_id', ${String(admin)}, true)`;
  return fn(tx);
});
const call = (name, payload) => t(async (tx) => {
  const [r] = await tx`select ex.${tx(name)}(${tx.json(payload)}) as r`;
  return r.r;
});

// ------------------------------------------------------------------- parties
let depositor, client;
await t(async (tx) => {
  const next = async () => (await tx`select 'P-' || lpad((coalesce(max(nullif(regexp_replace(party_code, '\\D', '', 'g'), ''))::bigint, 0) + 1)::text, 5, '0') as code from ex.party`)[0].code;
  let code = await next();
  [depositor] = await tx`insert into ex.party (party_code, full_name, phone, city, is_depositor)
                         values (${code}, 'Ravi Traders', '9800000011', 'Surat', true) returning id, party_code`;
  code = await next();
  [client] = await tx`insert into ex.party (party_code, full_name, phone, city, is_client)
                      values (${code}, 'Blue Ocean Imports', '9800000021', 'Mumbai', true) returning id, party_code`;
});

head("COMPANY A — SETTING UP");
console.log(`  company ${CODE}  Company A   admin amit@company-a.test`);
console.log(`  depositor  ${depositor.party_code}  Ravi Traders`);
console.log(`  client     ${client.party_code}  Blue Ocean Imports`);

const ob = await call("fn_post_voucher", {
  type: "OPENING", date: "2026-04-01", narration: "Opening balance as at 1 April 2026",
  lines: [{ account_code: "CASH-INR", fx_amount: "500000", dc: "D" },
          { account_code: "OB-EQUITY", fx_amount: "500000", dc: "C" }],
});
sub("opening balance");
console.log(`  ${ob.voucher_no}  Rs ${money(500000)} in rupees`);

// ------------------------------------------------------------------ helpers
const cash = async () => {
  sub("cash and bank now");
  for (const r of await t((tx) => tx`select a.code, trim(a.currency_code) as cur,
        sum(case when l.dc='D' then l.fx_amount else -l.fx_amount end) as fx,
        sum(case when l.dc='D' then l.inr_amount else -l.inr_amount end) as inr
        from ex.voucher_line l join ex.account a on a.id = l.account_id
        where a.code like 'CASH-%' group by a.code, a.currency_code having sum(case when l.dc='D' then l.fx_amount else -l.fx_amount end) <> 0 order by a.code`))
    console.log(`  ${r.code.padEnd(10)} ${fx(r.fx).padStart(14)}   Rs ${money(r.inr).padStart(14)}`);
};
const owed = async () => {
  sub("what we owe Ravi Traders");
  for (const d of await t((tx) => tx`select full_name, deposit_count, currency_brought_in, total_settled, outstanding_fx, outstanding_currency, outstanding_inr
                                        from ex.v_depositor_summary where deposit_count > 0`))
    console.log(`  ${d.full_name.padEnd(16)} ${d.deposit_count} deposit(s)  brought in USD ${fx(d.currency_brought_in)}  paid back Rs ${money(d.total_settled)}  still owed USD ${fx(d.outstanding_fx)}  carried at Rs ${money(d.outstanding_inr)}`);
};
const cycle = async (label) => {
  sub(label ?? "Ravi Traders' money, round the loop");
  for (const c of await t((tx) => tx`select * from ex.v_depositor_cycle where deposit_count > 0 order by full_name`))
    console.log(`  ${c.status.padEnd(7)} deposited USD ${fx(c.deposited_fx)} (${c.deposit_count})  dealt ${fx(c.dealt_fx)}  unspent ${fx(c.unspent_fx)}  ` +
                `billed Rs ${money(c.billed_inr)}  collected Rs ${money(c.collected_inr)}  settled USD ${fx(c.settled_fx)}  owed USD ${fx(c.owed_fx)}  earned Rs ${money(c.earned_inr)}`);
};
const clientSide = async () => {
  sub("Blue Ocean Imports — the two tracks");
  for (const c of await t((tx) => tx`select full_name, deal_count, total_billed, total_margin, receivable_inr, currency_payable_inr from ex.v_client_summary where deal_count > 0`))
    console.log(`  ${c.deal_count} deal(s)  billed Rs ${money(c.total_billed)}  margin Rs ${money(c.total_margin)}  they owe Rs ${money(c.receivable_inr)}  we owe currency worth Rs ${money(c.currency_payable_inr)}`);
  for (const d of await t((tx) => tx`select trim(currency_code) as cur, fx_due from ex.v_currency_due where fx_due > 0 order by currency_code`))
    console.log(`  still to hand over: ${d.cur} ${fx(d.fx_due)}`);
};
const tb = async (label) => {
  const [r] = await t((tx) => tx`select coalesce(sum(debit_inr),0) dr, coalesce(sum(credit_inr),0) cr from ex.v_trial_balance`);
  console.log(`  trial balance${label ? " " + label : ""}: Rs ${money(r.dr)} = Rs ${money(r.cr)}  ${Number(r.dr) === Number(r.cr) ? "AGREES" : "DOES NOT AGREE"}`);
};

// ------------------------------------------------------------------ deposits
head("STEP 1 — RAVI TRADERS DEPOSITS TWICE");
const DEPOSITS = [
  ["2026-04-02", "10000", "84.00", "SWIFT-A-1001"],
  ["2026-04-03",  "5000", "85.00", "SWIFT-A-1002"],
];
const depositIds = [];
for (const [date, amt, rate, ref] of DEPOSITS) {
  const r = await call("fn_post_deposit", { depositor_id: depositor.id, date, currency: "USD", fx_amount: amt, rate, reference_no: ref });
  depositIds.push(Number(r.id));
  console.log(`  ${r.voucher_no}  ${date}  USD ${fx(amt)} @ ${rate}  ->  we owe USD ${fx(r.fx_amount)}, carried at Rs ${money(r.inr_amount)}`);
}
sub("deposit register");
const depStatus = () => t((tx) => tx`select voucher_no, fx_amount, fx_unallocated, manual_rate, inr_amount from ex.v_deposit_status order by deposit_id`);
for (const d of await depStatus()) console.log(`  ${d.voucher_no}  USD ${fx(d.fx_amount)} @ ${d.manual_rate}  unspent ${fx(d.fx_unallocated)}  Rs ${money(d.inr_amount)}`);
await owed();
await cash();
await cycle();

// --------------------------------------------------------------------- deals
head("STEP 2 — BLUE OCEAN IMPORTS BUYS THREE CURRENCIES");
const DEALS = [
  ["2026-04-06", "EUR",  "5000",  "92.00", "5400", [[0, "5400"]]],
  ["2026-04-07", "GBP",  "3000", "108.00", "3800", [[0, "3800"]]],
  ["2026-04-08", "AED", "21000",  "23.60", "5800", [[0, "800"], [1, "5000"]]],
];
const deals = [];
for (const [date, cur, amt, rate, src, funding] of DEALS) {
  const r = await call("fn_post_deal", {
    client_id: client.id, date, fx_currency: cur, fx_amount: amt, fx_to_inr_rate: rate, src_amount: src,
    funding: funding.map(([i, a]) => ({ deposit_id: depositIds[i], fx_allocated: a })),
  });
  deals.push(r);
  console.log(`  ${r.voucher_no}  ${date}  ${cur} ${fx(amt)} @ ${rate}  spends USD ${fx(src)}  billed Rs ${money(r.billed_inr)}  cost Rs ${money(r.src_cost_inr)}  margin Rs ${money(r.margin_inr)}`);
}
sub("where the dollars for the AED deal came from — two deposits, two rates");
for (const f of await t((tx) => tx`select s.voucher_no, f.fx_allocated, f.manual_rate, f.cost_inr from ex.deal_funding f
                                    join ex.v_deposit_status s on s.deposit_id = f.deposit_id where f.deal_id = ${Number(deals[2].id)} order by f.deposit_id`))
  console.log(`  ${f.voucher_no}  USD ${fx(f.fx_allocated)} @ ${f.manual_rate}  = Rs ${money(f.cost_inr)}`);
sub("every deposit is now spent");
for (const d of await depStatus()) console.log(`  ${d.voucher_no}  unspent USD ${fx(d.fx_unallocated)}`);
await clientSide();
await cash();
await cycle();

// ------------------------------------------------------------------- payouts
head("STEP 3 — HANDING THE CURRENCY OVER");
for (const [date, cur, amt] of [["2026-04-09", "EUR", "5000"], ["2026-04-10", "GBP", "3000"], ["2026-04-11", "AED", "21000"]]) {
  const r = await call("fn_post_payout", { client_id: client.id, date, currency: cur, fx_amount: amt });
  console.log(`  ${r.voucher_no}  ${date}  handed over ${cur} ${fx(amt)}  was owed ${fx(r.was_due_fx)}  now owed ${fx(r.now_due_fx)}  (exchange difference Rs ${money(r.gain_inr)})`);
}
await clientSide();
await cash();

// ------------------------------------------------------------------ receipts
head("STEP 4 — BLUE OCEAN IMPORTS PAYS ITS RUPEES");
for (const [date, amt, ref] of [["2026-04-13", "460000", "NEFT-A-2001"], ["2026-04-14", "324000", "NEFT-A-2002"], ["2026-04-15", "495600", "NEFT-A-2003"]]) {
  const r = await call("fn_post_receipt", { client_id: client.id, date, inr_amount: amt, reference_no: ref });
  console.log(`  ${r.voucher_no}  ${date}  took Rs ${money(amt)}  was owed Rs ${money(r.was_owed)}  now owed Rs ${money(r.now_owed)}`);
}
await clientSide();
await cash();
await cycle();

// --------------------------------------------------------------- settlements
head("STEP 5 — PAYING RAVI TRADERS BACK, FIVE TIMES");
const SETTLEMENTS = [
  ["2026-04-16", "3000", "84.00", "NEFT-A-3001"],
  ["2026-04-18", "3000", "84.50", "NEFT-A-3002"],
  ["2026-04-20", "3000", "85.00", "NEFT-A-3003"],
  ["2026-04-22", "3000", "84.25", "NEFT-A-3004"],
  ["2026-04-24", "3000", "84.00", "NEFT-A-3005"],
];
for (const [date, amt, rate, ref] of SETTLEMENTS) {
  const r = await call("fn_post_settlement", { depositor_id: depositor.id, date, currency: "USD", fx_amount: amt, rate, reference_no: ref });
  const g = Number(r.gain_inr);
  console.log(`  ${r.voucher_no}  ${date}  USD ${fx(amt)} @ ${rate}  paid Rs ${money(r.inr_amount)}  released Rs ${money(r.released_inr)} (carried ${Number(r.carried_at).toFixed(6)})  ` +
              `${g > 0 ? "gain" : g < 0 ? "LOSS" : "no difference"} Rs ${money(Math.abs(g))}  still owed USD ${fx(r.now_owed_fx)}`);
}
await owed();
await cash();
await cycle("Ravi Traders' money, round the loop — the cycle should now be CLOSED");

// --------------------------------------------------------------- the books
head("DO THE BOOKS AGREE");
sub("trial balance");
for (const r of await t((tx) => tx`select a.code, a.name,
        sum(case when l.dc='D' then l.inr_amount else -l.inr_amount end) as bal
        from ex.voucher_line l join ex.account a on a.id = l.account_id group by a.code, a.name having sum(case when l.dc='D' then l.inr_amount else -l.inr_amount end) <> 0 order by a.code`))
  console.log(`  ${r.code.padEnd(16)}${r.name.padEnd(32)}${Number(r.bal) >= 0 ? "Dr" : "Cr"} Rs ${money(Math.abs(r.bal)).padStart(14)}`);
await tb();
sub("profit and loss");
const pl = await t((tx) => tx`select a.code, a.name, a.account_type,
        sum(case when l.dc='C' then l.inr_amount else -l.inr_amount end) as cr
        from ex.voucher_line l join ex.account a on a.id = l.account_id where a.account_type in ('INCOME','EXPENSE') group by a.code, a.name, a.account_type having sum(l.inr_amount) <> 0 order by a.account_type desc, a.code`);
let earned = 0, spent = 0;
for (const r of pl) { const v = Number(r.cr); if (r.account_type === "INCOME") earned += v; else spent -= v;
  console.log(`  ${r.code.padEnd(16)}${r.name.padEnd(32)}Rs ${money(Math.abs(v)).padStart(12)} (${r.account_type.toLowerCase()})`); }
console.log(`  earned Rs ${money(earned)}   spent Rs ${money(spent)}   PROFIT Rs ${money(earned - spent)}`);
sub("what each depositor has earned the desk");
for (const p of await t((tx) => tx`select full_name, funded_deals, currency_dealt, dealing_margin, rate_gain, total_earned from ex.v_depositor_profit where funded_deals > 0`))
  console.log(`  ${p.full_name.padEnd(16)} ${p.funded_deals} deal(s)  dealt USD ${fx(p.currency_dealt)}  margin Rs ${money(p.dealing_margin)}  on the rate Rs ${money(p.rate_gain)}  earned Rs ${money(p.total_earned)}`);
sub("every voucher posted, in order");
for (const v of await t((tx) => tx`select v.voucher_no, to_char(v.voucher_date,'DD Mon YYYY') as voucher_date, v.voucher_type, p.full_name, v.total_inr, v.status
                                    from ex.voucher v left join ex.party p on p.id = v.party_id order by v.id`))
  console.log(`  ${v.voucher_no.padEnd(26)} ${v.voucher_date}  ${v.voucher_type.padEnd(11)}${(v.full_name ?? "").padEnd(20)} Rs ${money(v.total_inr).padStart(13)}  ${v.status}`);
const [n] = await t((tx) => tx`select (select count(*) from ex.voucher) as vouchers, (select count(*) from ex.voucher_line) as lines`);
console.log(`\n  ${n.vouchers} vouchers, ${n.lines} lines`);

await sql.end();
