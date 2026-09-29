#!/usr/bin/env node
/**
 * LOCAL ONLY. Runs the whole acceptance-test scenario (docs/testing/*) through the real business
 * functions and prints what the software actually says at every checkpoint, so the expected
 * figures in the testing documents are proven rather than worked out on paper.
 *
 *   node scripts/uat-scenario.mjs --db <admin URL> [--keep]
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
const fx = (n) => Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const head = (t) => console.log(`\n${"=".repeat(78)}\n${t}\n${"=".repeat(78)}`);
const sub = (t) => console.log(`\n--- ${t} ${"-".repeat(Math.max(0, 70 - t.length))}`);

// ---------------------------------------------------------------- the company
await sql.begin(async (tx) => {
  await tx`set local session_replication_role = replica`;
  const [c] = await tx`select id from ex.company where code = 'C001'`;
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
  [{ cid }] = await tx`select (ex.fn_register_company('C001', 'Acceptance Test Desk', 'Test Admin',
                        'admin@uat.test', ${pwHash}, 'INR', 'USD')->>'company_id')::bigint as cid`;
  await tx`set local role ex_app`;
  await tx`select set_config('app.company_id', ${String(cid)}, true)`;
  [{ admin }] = await tx`select id as admin from ex.app_user where user_type = 'ADMIN'`;
  await tx`select set_config('app.user_id', ${String(admin)}, true)`;
  // the company's own first act, exactly as its Administrator does it on the screen
  await tx`select ex.fn_complete_company_setup(${tx.json({
    legal_name: "Acceptance Test Desk", display_name: "Acceptance Test Desk",
    primary_currency: "USD", city: "Surat",
  })})`;
  await tx`insert into ex.company_currency (currency_code) select unnest(array['EUR','GBP','AED','CHF'])`;
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
const tryCall = async (name, payload) => {
  try { return { ok: true, r: await call(name, payload) }; }
  catch (e) { return { ok: false, message: String(e.message || e).replace(/^error: /, "") }; }
};

// ------------------------------------------------------------------- parties
const DEPOSITORS = [
  ["Mehta Exports", "9825011111", "Surat"],
  ["Shah Enterprise", "9825022222", "Surat"],
  ["Patel Trading", "9825033333", "Ahmedabad"],
  ["Rathod & Sons", "9825044444", "Mumbai"],
];
const CLIENTS = [
  ["Kumar Overseas", "9727011111", "Surat"],
  ["Divya Travels", "9727022222", "Surat"],
  ["Ocean Impex", "9727033333", "Mumbai"],
  ["Surat Tours", "9727044444", "Surat"],
  ["Global Link Services", "9727055555", "Delhi"],
  ["Krishna Traders", "9727066666", "Rajkot"],
];
const dep = {}, cli = {};
await t(async (tx) => {
  for (const [name, phone, city] of DEPOSITORS) {
    const [{ code }] = await tx`select 'P-' || lpad((coalesce(max(nullif(regexp_replace(party_code, '\\D', '', 'g'), ''))::bigint, 0) + 1)::text, 5, '0') as code from ex.party`;
    const [r] = await tx`insert into ex.party (party_code, full_name, phone, city, is_depositor)
                         values (${code}, ${name}, ${phone}, ${city}, true) returning id, party_code`;
    dep[name] = { id: Number(r.id), code: r.party_code };
  }
  for (const [name, phone, city] of CLIENTS) {
    const [{ code }] = await tx`select 'P-' || lpad((coalesce(max(nullif(regexp_replace(party_code, '\\D', '', 'g'), ''))::bigint, 0) + 1)::text, 5, '0') as code from ex.party`;
    const [r] = await tx`insert into ex.party (party_code, full_name, phone, city, is_client)
                         values (${code}, ${name}, ${phone}, ${city}, true) returning id, party_code`;
    cli[name] = { id: Number(r.id), code: r.party_code };
  }
});

head("BOOK 1 — SETTING UP");
sub("the codes the software gave the parties");
for (const [n, v] of Object.entries(dep)) console.log(`  depositor  ${v.code}  ${n}`);
for (const [n, v] of Object.entries(cli)) console.log(`  client     ${v.code}  ${n}`);

sub("chart of accounts");
console.log((await t((tx) => tx`select code, name, account_type from ex.account order by code`))
  .map((a) => `  ${a.code.padEnd(16)}${a.name.padEnd(34)}${a.account_type}`).join("\n"));

// --------------------------------------------------------- the opening balance
const ob = await call("fn_post_voucher", {
  type: "OPENING", date: "2026-04-01", narration: "Opening balance as at 1 April 2026",
  lines: [{ account_code: "CASH-INR", fx_amount: "500000", dc: "D" },
          { account_code: "OB-EQUITY", fx_amount: "500000", dc: "C" }],
});
sub("opening balance");
console.log(`  ${ob.voucher_no}  Rs ${money(ob.total_inr ?? 500000)}`);
const ob2 = await tryCall("fn_post_voucher", {
  type: "OPENING", date: "2026-04-01",
  lines: [{ account_code: "CASH-INR", fx_amount: "1", dc: "D" },
          { account_code: "OB-EQUITY", fx_amount: "1", dc: "C" }],
});
console.log(`  a second opening balance -> ${ob2.ok ? "POSTED (WRONG)" : ob2.message}`);

// ------------------------------------------------------------------- deposits
head("BOOK 2 — DEPOSITS");
// currency, amount, the dollars one buys (null when it IS dollars), the rupee rate
const DEPOSITS = [
  ["Mehta Exports",   "2026-04-02", "USD", "20000", null,   "86.00",  "SWIFT-88201"],
  ["Shah Enterprise", "2026-04-02", "USD", "15000", null,   "85.50",  "SWIFT-88202"],
  ["Patel Trading",   "2026-04-03", "USD", "10000", null,   "86.50",  "SWIFT-88203"],
  ["Rathod & Sons",   "2026-04-04", "USD",  "5000", null,   "85.75",  "SWIFT-88204"],
  // handed over in euros and changed on the same voucher: 10,000 x 1.08 = USD 10,800
  ["Rathod & Sons",   "2026-04-05", "EUR", "10000", "1.08", "86.00",  "SWIFT-88205"],
];
const depositId = {};
for (const [name, date, cur, amt, conv, rate, ref] of DEPOSITS) {
  const r = await call("fn_post_deposit", {
    depositor_id: dep[name].id, date, currency: cur, fx_amount: amt,
    to_primary_rate: conv, rate, reference_no: ref });
  // keyed by depositor, and the FIRST deposit wins: the deals below name their funding by
  // depositor, so a second deposit for the same person must not silently become what they draw
  // on. The euro deposit is therefore left unspent, which is the point of showing it — once
  // changed, those dollars are ordinary dollars sitting in the register waiting for a deal.
  depositId[name] ??= Number(r.id);
  const how = conv ? `${cur} ${String(amt).padStart(7)} @ ${conv} -> USD ${fx(r.fx_amount)}` : `USD ${String(amt).padStart(7)}`;
  console.log(`  ${r.voucher_no}  ${name.padEnd(18)} ${how} @ ${rate}  ->  we owe USD ${fx(r.fx_amount)} (carried Rs ${money(r.inr_amount)})`);
}
sub("the euro deposit, line by line — what came in, and what it was changed into");
for (const l of await t((tx) => tx`select a.code, l.dc, trim(l.currency_code) as cur, l.fx_amount, l.inr_amount, l.remarks
                                     from ex.voucher_line l join ex.account a on a.id = l.account_id
                                     join ex.voucher v on v.id = l.voucher_id
                                    where v.reference_no = 'SWIFT-88205' order by l.line_no`))
  console.log(`  ${l.code.padEnd(12)}${l.dc}  ${l.cur} ${fx(l.fx_amount).padStart(13)}  Rs ${money(l.inr_amount).padStart(12)}   ${l.remarks ?? ""}`);
sub("deposit register — how much of each is still unspent");
const depStatus = async () => t((tx) => tx`select voucher_no, depositor_name, fx_amount, fx_unallocated, inr_amount
                                             from ex.v_deposit_status order by deposit_id`);
for (const d of await depStatus()) console.log(`  ${d.voucher_no}  ${d.depositor_name.padEnd(18)} USD ${fx(d.fx_amount)}  unspent ${fx(d.fx_unallocated)}  Rs ${money(d.inr_amount)}`);
sub("what we owe the depositors");
const depSummary = async () => t((tx) => tx`select full_name, deposit_count, currency_brought_in, value_brought_in, total_settled,
                                                    outstanding_inr, outstanding_fx, outstanding_currency
                                              from ex.v_depositor_summary where outstanding_inr <> 0 or deposit_count > 0 order by full_name`);
let totOwed = 0, totOwedFx = 0;
for (const d of await depSummary()) { totOwed += Number(d.outstanding_inr); totOwedFx += Number(d.outstanding_fx);
  console.log(`  ${d.full_name.padEnd(18)} ${d.deposit_count} deposit(s)  brought in USD ${fx(d.currency_brought_in)}  owed ${fx(d.outstanding_fx)} ${(d.outstanding_currency ?? "").trim()}  carried Rs ${money(d.outstanding_inr)}`); }
console.log(`  TOTAL OWED TO DEPOSITORS  USD ${fx(totOwedFx)}  carried at Rs ${money(totOwed)}`);

// ---------------------------------------------------------------------- deals
head("BOOK 3 — DEALS");
const DEALS = [
  ["Kumar Overseas",       "2026-04-06", "EUR", "18400", "95.00", "20000", [["Mehta Exports", "20000"]]],
  ["Divya Travels",        "2026-04-07", "GBP",  "7900", "112.00", "10000", [["Shah Enterprise", "10000"]]],
  ["Ocean Impex",          "2026-04-08", "AED", "36700", "24.20", "10000", [["Shah Enterprise", "5000"], ["Patel Trading", "5000"]]],
  ["Surat Tours",          "2026-04-09", "CHF",  "4450", "96.00",  "5000", [["Patel Trading", "5000"]]],
  ["Global Link Services", "2026-04-10", "EUR",  "4600", "96.00",  "5000", [["Rathod & Sons", "5000"]]],
];
const dealOf = {};
for (const [name, date, cur, amt, rate, src, funding] of DEALS) {
  const r = await call("fn_post_deal", {
    client_id: cli[name].id, date, fx_currency: cur, fx_amount: amt, fx_to_inr_rate: rate, src_amount: src,
    funding: funding.map(([d, a]) => ({ deposit_id: depositId[d], fx_allocated: a })),
  });
  dealOf[name] = r;
  console.log(`  ${r.voucher_no}  ${name.padEnd(21)} ${cur} ${String(amt).padStart(6)} @ ${rate}` +
              `  billed Rs ${money(r.billed_inr)}  cost Rs ${money(r.src_cost_inr)}  margin Rs ${money(r.margin_inr)}`);
}
sub("where the currency for the AED deal came from");
console.log((await t((tx) => tx`select s.voucher_no, s.depositor_name, f.fx_allocated, f.manual_rate, f.cost_inr
                                  from ex.deal_funding f join ex.v_deposit_status s on s.deposit_id = f.deposit_id
                                 where f.deal_id = ${Number(dealOf["Ocean Impex"].id)} order by s.deposit_date, f.deposit_id`))
  .map((f) => `  ${f.voucher_no}  ${f.depositor_name.padEnd(18)} USD ${fx(f.fx_allocated)} @ ${f.manual_rate}  = Rs ${money(f.cost_inr)}`).join("\n"));
sub("every deposit is now spent");
for (const d of await depStatus()) console.log(`  ${d.voucher_no}  ${d.depositor_name.padEnd(18)} unspent USD ${fx(d.fx_unallocated)}`);

const clientSummary = async () => t((tx) => tx`select full_name, deal_count, total_billed, total_margin, receivable_inr, currency_payable_inr
                                                 from ex.v_client_summary where deal_count > 0 or receivable_inr <> 0 or currency_payable_inr <> 0
                                                order by full_name`);
sub("what each client owes us, and what we owe them");
for (const c of await clientSummary())
  console.log(`  ${c.full_name.padEnd(21)} ${c.deal_count} deal(s)  they owe Rs ${money(c.receivable_inr)}  we owe them currency worth Rs ${money(c.currency_payable_inr)}`);

const position = async () => t((tx) => tx`select trim(currency_code) as cur, balance_fx, balance_inr
                                            from ex.v_currency_position where balance_fx <> 0 order by 1`);
const due = async () => t((tx) => tx`select full_name, currency_code, fx_due, inr_value from ex.v_currency_due order by full_name, currency_code`);
const tb = async () => t((tx) => tx`select coalesce(sum(debit_inr),0) dr, coalesce(sum(credit_inr),0) cr from ex.v_trial_balance`);
sub("currency the desk is holding");
for (const p of await position()) console.log(`  ${p.cur}  ${fx(p.balance_fx).padStart(14)}  carried at Rs ${money(p.balance_inr)}  (Rs ${(Number(p.balance_inr)/Number(p.balance_fx)).toFixed(6)} each)`);
sub("currency still to be delivered");
for (const d of await due()) console.log(`  ${d.full_name.padEnd(21)} ${d.currency_code} ${fx(d.fx_due).padStart(12)}  worth Rs ${money(d.inr_value)}`);
const [b1] = await tb(); console.log(`\n  trial balance: Rs ${money(b1.dr)} = Rs ${money(b1.cr)}  ${b1.dr === b1.cr ? "AGREES" : "DOES NOT AGREE"}`);

// --------------------------------------------- payouts, receipts, settlements
head("BOOK 4 — HANDING OVER AND COLLECTING");
sub("payouts");
for (const [name, date, cur, amt] of [
  ["Kumar Overseas", "2026-04-11", "EUR", "10000"],
  ["Divya Travels",  "2026-04-12", "GBP",  "7900"],
  ["Ocean Impex",    "2026-04-13", "AED", "20000"],
]) {
  const r = await call("fn_post_payout", { client_id: cli[name].id, date, currency: cur, fx_amount: amt });
  console.log(`  ${r.voucher_no}  ${name.padEnd(21)} handed over ${cur} ${String(amt).padStart(6)}` +
              `  was owed ${fx(r.was_due_fx)}  now owed ${fx(r.now_due_fx)}  (exchange difference Rs ${money(r.gain_inr)})`);
}
sub("receipts");
for (const [name, date, amt] of [
  ["Kumar Overseas", "2026-04-14", "500000"],
  ["Divya Travels",  "2026-04-15", "884800"],
  ["Ocean Impex",    "2026-04-16", "200000"],
]) {
  const r = await call("fn_post_receipt", { client_id: cli[name].id, date, inr_amount: amt });
  console.log(`  ${r.voucher_no}  ${name.padEnd(21)} took Rs ${money(amt).padStart(13)}  was owed Rs ${money(r.was_owed)}  now owed Rs ${money(r.now_owed)}`);
}
sub("settlements");
// The depositor is owed DOLLARS. What those cost in rupees is agreed on the day they are paid,
// so one of these goes the desk's way and one does not — deliberately, because a tester who has
// only ever seen the rate move one way has not seen the feature.
for (const [name, date, amt, rate] of [
  ["Mehta Exports",   "2026-04-17", "11500", "87.00"],   // carried at 86.00 — costs more
  ["Shah Enterprise", "2026-04-18",  "9000", "84.50"],   // carried at 85.50 — costs less
]) {
  const r = await call("fn_post_settlement", { depositor_id: dep[name].id, date, fx_amount: amt, rate });
  const g = Number(r.gain_inr);
  const moved = g > 1 ? `gain Rs ${money(g)}` : g < -1 ? `LOSS Rs ${money(-g)}` : "no difference";
  console.log(`  ${r.voucher_no}  ${name.padEnd(18)} USD ${String(amt).padStart(6)} @ ${rate}  paid Rs ${money(r.inr_amount).padStart(12)}`
            + `  released Rs ${money(r.released_inr).padStart(12)} (carried ${Number(r.carried_at).toFixed(4)})  ${moved}`
            + `  still owed USD ${fx(r.now_owed_fx)}`);
}

const cash = async () => t((tx) => tx`select code, name, balance_fx, balance_inr from ex.v_account_balance
                                       where account_group = 'CASH_BANK' and (balance_fx <> 0 or balance_inr <> 0) order by code`);
sub("cash and bank now");
for (const a of await cash()) console.log(`  ${a.code.padEnd(10)} ${fx(a.balance_fx).padStart(14)}  Rs ${money(a.balance_inr)}`);
sub("still to deliver");
for (const d of await due()) console.log(`  ${d.full_name.padEnd(21)} ${d.currency_code} ${fx(d.fx_due).padStart(12)}  worth Rs ${money(d.inr_value)}`);
const cycles = async () => {
  sub("where each depositor's money is — the loop, stage by stage");
  for (const c of await t((tx) => tx`select full_name, status, deposited_fx, dealt_fx, unspent_fx, billed_inr, collected_inr,
                                            uncollected_inr, settled_fx, owed_fx, earned_inr
                                       from ex.v_depositor_cycle order by full_name`))
    console.log(`  ${c.full_name.padEnd(18)} ${c.status.padEnd(7)} in USD ${fx(c.deposited_fx).padStart(10)}  dealt ${fx(c.dealt_fx).padStart(10)}  unspent ${fx(c.unspent_fx).padStart(10)}`
              + `  billed Rs ${money(c.billed_inr).padStart(12)}  collected Rs ${money(c.collected_inr).padStart(12)}`
              + `  settled USD ${fx(c.settled_fx).padStart(10)}  owed USD ${fx(c.owed_fx).padStart(10)}  earned Rs ${money(c.earned_inr).padStart(10)}`);
};
sub("client and depositor position");
for (const c of await clientSummary()) console.log(`  ${c.full_name.padEnd(21)} they owe Rs ${money(c.receivable_inr).padStart(13)}   we owe currency worth Rs ${money(c.currency_payable_inr)}`);
for (const d of await depSummary()) console.log(`  ${d.full_name.padEnd(21)} we owe Rs ${money(d.outstanding_inr)}`);

// -------------------------------------------------------------- the last deal
await cycles();

head("BOOK 5 — THE SIXTH CLIENT (after a fresh deposit)");
const none = await tryCall("fn_post_deal", {
  client_id: cli["Krishna Traders"].id, date: "2026-04-19", fx_currency: "EUR", fx_amount: "7360",
  fx_to_inr_rate: "95.50", src_amount: "8000", funding: [{ deposit_id: depositId["Mehta Exports"], fx_allocated: "8000" }],
});
console.log(`  booking it with nothing left to fund it -> ${none.ok ? "POSTED (WRONG)" : none.message}`);
const d5 = await call("fn_post_deposit", { depositor_id: dep["Mehta Exports"].id, date: "2026-04-19",
  fx_amount: "8000", rate: "86.25", reference_no: "SWIFT-88205" });
depositId["Mehta 2"] = Number(d5.id);
console.log(`  ${d5.voucher_no}  Mehta Exports second deposit USD 8,000 @ 86.25 -> we owe Rs ${money(d5.inr_amount)}`);
const d6 = await call("fn_post_deal", { client_id: cli["Krishna Traders"].id, date: "2026-04-20",
  fx_currency: "EUR", fx_amount: "7360", fx_to_inr_rate: "95.50", src_amount: "8000",
  funding: [{ deposit_id: depositId["Mehta 2"], fx_allocated: "8000" }] });
console.log(`  ${d6.voucher_no}  Krishna Traders EUR 7,360 @ 95.50  billed Rs ${money(d6.billed_inr)}  cost Rs ${money(d6.src_cost_inr)}  margin Rs ${money(d6.margin_inr)}`);

// ------------------------------------------------------------- what it refuses
head("BOOK 6 — WHAT THE SOFTWARE MUST REFUSE");
const spare = await call("fn_post_deposit", { depositor_id: dep["Rathod & Sons"].id, date: "2026-04-21",
  fx_amount: "3000", rate: "86.00", reference_no: "SWIFT-88206" });
depositId["spare"] = Number(spare.id);
console.log(`  first, one more deposit left deliberately unspent: ${spare.voucher_no}  USD 3,000 @ 86.00 = Rs ${money(spare.inr_amount)}\n`);
const refusals = [
  ["hand over more currency than the client is owed",
    ["fn_post_payout", { client_id: cli["Kumar Overseas"].id, currency: "EUR", fx_amount: "99999" }]],
  ["hand over a currency the client is owed none of",
    ["fn_post_payout", { client_id: cli["Kumar Overseas"].id, currency: "CHF", fx_amount: "100" }]],
  ["hand over currency to somebody who is owed nothing at all",
    ["fn_post_payout", { client_id: cli["Divya Travels"].id, currency: "GBP", fx_amount: "100" }]],
  ["take more rupees than the client owes",
    ["fn_post_receipt", { client_id: cli["Ocean Impex"].id, inr_amount: "9999999" }]],
  ["pay a depositor more than we owe them",
    ["fn_post_settlement", { depositor_id: dep["Patel Trading"].id, fx_amount: "999999", rate: "86" }]],
  ["pay out more rupees than the desk actually holds",
    ["fn_post_settlement", { depositor_id: dep["Patel Trading"].id, fx_amount: "10000", rate: "86" }]],
  ["settle a depositor without saying what rate was agreed",
    ["fn_post_settlement", { depositor_id: dep["Patel Trading"].id, fx_amount: "100" }]],
  ["a deposit in a currency this company does not deal in",
    ["fn_post_deposit", { depositor_id: dep["Patel Trading"].id, fx_amount: "1000", rate: "95", currency: "JPY" }]],
  ["a deposit in another currency with no rate to turn it into dollars",
    ["fn_post_deposit", { depositor_id: dep["Patel Trading"].id, fx_amount: "1000", rate: "95", currency: "EUR" }]],
  ["a deposit of nothing",
    ["fn_post_deposit", { depositor_id: dep["Patel Trading"].id, fx_amount: "0", rate: "86" }]],
  ["a deposit at a rate of nothing",
    ["fn_post_deposit", { depositor_id: dep["Patel Trading"].id, fx_amount: "1000", rate: "0" }]],
  ["a deal whose funding does not add up to what it spends",
    ["fn_post_deal", { client_id: cli["Krishna Traders"].id, fx_currency: "EUR", fx_amount: "100",
      fx_to_inr_rate: "95", src_amount: "3000", funding: [{ deposit_id: depositId["spare"], fx_allocated: "1000" }] }]],
  ["a deal taking more from a deposit than that deposit has left",
    ["fn_post_deal", { client_id: cli["Krishna Traders"].id, fx_currency: "EUR", fx_amount: "100",
      fx_to_inr_rate: "95", src_amount: "9000", funding: [{ deposit_id: depositId["spare"], fx_allocated: "9000" }] }]],
  ["a deal in the book currency",
    ["fn_post_deal", { client_id: cli["Krishna Traders"].id, fx_currency: "INR", fx_amount: "100",
      fx_to_inr_rate: "1", src_amount: "100", funding: [{ deposit_id: depositId["spare"], fx_allocated: "100" }] }]],
  ["a deal for a party who is not a client",
    ["fn_post_deal", { client_id: dep["Patel Trading"].id, fx_currency: "EUR", fx_amount: "100",
      fx_to_inr_rate: "95", src_amount: "3000", funding: [{ deposit_id: depositId["spare"], fx_allocated: "3000" }] }]],
  ["a deposit from a party who is not a depositor",
    ["fn_post_deposit", { depositor_id: cli["Kumar Overseas"].id, fx_amount: "1000", rate: "86" }]],
  ["a voucher that does not balance",
    ["fn_post_voucher", { type: "JOURNAL", date: "2026-04-21",
      lines: [{ account_code: "CASH-INR", fx_amount: "1000", dc: "D" }, { account_code: "OB-EQUITY", fx_amount: "900", dc: "C" }] }]],
  ["a rupee line at a rate other than 1",
    ["fn_post_voucher", { type: "JOURNAL", date: "2026-04-21",
      lines: [{ account_code: "CASH-INR", currency: "INR", fx_amount: "1000", rate: "2", inr_amount: "2000", dc: "D" },
              { account_code: "OB-EQUITY", currency: "INR", fx_amount: "2000", rate: "1", inr_amount: "2000", dc: "C" }] }]],
  ["a currency an account does not hold",
    ["fn_post_voucher", { type: "JOURNAL", date: "2026-04-21",
      lines: [{ account_code: "CASH-EUR", currency: "GBP", fx_amount: "10", rate: "112", inr_amount: "1120", dc: "D" },
              { account_code: "OB-EQUITY", currency: "INR", fx_amount: "1120", rate: "1", inr_amount: "1120", dc: "C" }] }]],
  ["taking rupees out of an account that does not have them",
    ["fn_post_voucher", { type: "EXPENSE", date: "2026-04-21",
      lines: [{ account_code: "BANK-CHG", fx_amount: "9999999", dc: "D" }, { account_code: "CASH-INR", fx_amount: "9999999", dc: "C" }] }]],
];
for (const [label, [fn, payload]] of refusals) {
  const r = await tryCall(fn, payload);
  console.log(`  ${(r.ok ? "!! ALLOWED" : "refused").padEnd(10)} ${label}\n             -> ${r.ok ? JSON.stringify(r.r) : r.message}`);
}

// ------------------------------------------------------------------ reversals
head("BOOK 7 — PUTTING A MISTAKE RIGHT");
// a failing query aborts its whole transaction, so every expected refusal runs in one of its own
const tryReverse = async (id, reason) => {
  try { const r = await t(async (tx) => (await tx`select ex.fn_reverse_voucher(${id}, ${reason}) as r`)[0].r); return { ok: true, r }; }
  catch (e) { return { ok: false, message: String(e.message || e).replace(/^error: /, "") }; }
};
const vno = async (id) => (await t((tx) => tx`select voucher_no from ex.voucher where id = ${id}`))[0].voucher_no;

const [aedPayout] = await t((tx) => tx`select id, voucher_no from ex.voucher
                                        where voucher_type = 'PAYOUT' and party_id = ${cli["Ocean Impex"].id} order by id limit 1`);
const [depVoucher] = await t((tx) => tx`select v.id, v.voucher_no from ex.voucher v join ex.deposit d on d.voucher_id = v.id
                                         where d.depositor_id = ${dep["Mehta Exports"].id} order by v.id limit 1`);
const spareDeposit = await t((tx) => tx`select v.id, v.voucher_no from ex.voucher v join ex.deposit d on d.voucher_id = v.id
                                         where d.id = ${depositId["spare"]}`);

let r;
r = await tryReverse(Number(aedPayout.id), "");
console.log(`  reversing ${aedPayout.voucher_no} with no reason            -> ${r.ok ? "POSTED (WRONG)" : r.message}`);
r = await tryReverse(Number(depVoucher.id), "wrong depositor");
console.log(`  reversing a deposit already spent on a deal     -> ${r.ok ? "POSTED (WRONG)" : r.message}`);
r = await tryReverse(Number(dealOf["Ocean Impex"].voucher_id), "wrong client");
console.log(`  reversing a deal whose currency has gone out    -> ${r.ok ? "POSTED (WRONG)" : r.message}`);

sub("a deposit that has not been touched can be taken back");
console.log(`  before: we owe Rathod & Sons Rs ${money((await depSummary()).find((d) => d.full_name === "Rathod & Sons").outstanding_inr)}`);
r = await tryReverse(Number(spareDeposit[0].id), "the money never arrived in the bank");
console.log(`  ${r.r.voucher_no}  cancels ${r.r.reversed} — reason: ${r.r.reason}`);
console.log(`  after:  we owe Rathod & Sons Rs ${money((await depSummary()).find((d) => d.full_name === "Rathod & Sons").outstanding_inr)}`);
console.log(`  USD the desk holds now: ${fx((await position()).find((p) => p.cur === "USD")?.balance_fx ?? 0)}`);

sub("a payout that never happened");
console.log(`  before: Ocean Impex is owed AED ${fx((await due()).find((d) => d.full_name === "Ocean Impex").fx_due)}`);
r = await tryReverse(Number(aedPayout.id), "the client never collected it");
const revId = Number(r.r.id);
console.log(`  ${r.r.voucher_no}  cancels ${r.r.reversed} — reason: ${r.r.reason}`);
console.log(`  after:  Ocean Impex is owed AED ${fx((await due()).find((d) => d.full_name === "Ocean Impex").fx_due)}   (must be 36,700 — NOT 56,700)`);
console.log(`  AED the desk holds now: ${fx((await position()).find((p) => p.cur === "AED").balance_fx)}`);
r = await tryReverse(Number(aedPayout.id), "again");
console.log(`  reversing the same voucher twice                -> ${r.ok ? "POSTED (WRONG)" : r.message}`);
r = await tryReverse(revId, "undo the undo");
console.log(`  reversing the reversal itself                   -> ${r.ok ? "POSTED (WRONG)" : r.message}`);
console.log(`  the cancelled voucher now reads: ${(await t((tx) => tx`select status from ex.voucher where id = ${Number(aedPayout.id)}`))[0].status}` +
            `, cancelled by ${await vno(revId)}`);
const [b2] = await tb(); console.log(`  trial balance: Rs ${money(b2.dr)} = Rs ${money(b2.cr)}  ${b2.dr === b2.cr ? "AGREES" : "DOES NOT AGREE"}`);

// -------------------------------------------------------------------- reports
head("BOOK 8 — DO THE BOOKS AGREE");
sub("trial balance");
for (const a of await t((tx) => tx`select code, name, debit_inr, credit_inr from ex.v_trial_balance order by code`))
  console.log(`  ${a.code.padEnd(16)}${a.name.padEnd(34)}Dr ${money(a.debit_inr).padStart(14)}   Cr ${money(a.credit_inr).padStart(14)}`);
const [b3] = await tb(); console.log(`  ${"".padEnd(50)}Rs ${money(b3.dr).padStart(14)}   Rs ${money(b3.cr).padStart(14)}`);
sub("cash and bank");
for (const a of await cash()) console.log(`  ${a.code.padEnd(10)} ${fx(a.balance_fx).padStart(14)}  Rs ${money(a.balance_inr)}`);
sub("currency held against currency owed");
const held = Object.fromEntries((await position()).map((p) => [p.cur, p]));
const owed = {};
for (const d of await due()) owed[d.currency_code] = { fx: Number(owed[d.currency_code]?.fx ?? 0) + Number(d.fx_due), inr: Number(owed[d.currency_code]?.inr ?? 0) + Number(d.inr_value) };
for (const cur of new Set([...Object.keys(held), ...Object.keys(owed)])) {
  const h = Number(held[cur]?.balance_fx ?? 0), o = Number(owed[cur]?.fx ?? 0);
  console.log(`  ${cur}  held ${fx(h).padStart(14)}   owed ${fx(o).padStart(14)}   ${h === o ? "matched" : `DIFFERENCE ${fx(h - o)}`}`);
}
sub("margin earned");
for (const a of await t((tx) => tx`select code, name, balance_inr from ex.v_account_balance
                                    where account_type in ('INCOME','EXPENSE') and balance_inr <> 0 order by code`))
  console.log(`  ${a.code.padEnd(16)}${a.name.padEnd(34)}Rs ${money(Math.abs(a.balance_inr))} ${Number(a.balance_inr) < 0 ? "(income)" : "(expense)"}`);

// ------------------------------------------------------------------- year end
head("BOOK 9 — THE YEAR END");
sub("the open positions the year-end screen shows");
for (const cur of [...new Set([...Object.keys(held), ...Object.keys(owed)])].filter((c) => c !== "INR").sort()) {
  const h = held[cur], o = owed[cur];
  const rate = h ? (Number(h.balance_inr) / Number(h.balance_fx)).toFixed(6) : "—";
  console.log(`  ${cur}  held ${fx(h?.balance_fx ?? 0).padStart(13)} at Rs ${rate}   owed ${fx(o?.fx ?? 0).padStart(13)} worth Rs ${money(o?.inr ?? 0)}`);
}
// USD is here because the desk both HOLDS dollars and OWES dollars to its depositors. Both
// sides are restated at the same closing rate, so whatever is matched revalues to nothing and
// only the uncovered part moves — the same rule the client currencies follow.
const RATES = [{ currency: "USD", rate: "87.00" },
                { currency: "EUR", rate: "97.00" }, { currency: "GBP", rate: "113.00" },
                { currency: "AED", rate: "24.50" }, { currency: "CHF", rate: "97.50" }];
sub(`revaluing at the closing rates ${RATES.map((r) => `${r.currency} ${r.rate}`).join(", ")}`);
const rv = await call("fn_revalue_currency", { date: "2027-03-31", rates: RATES });
console.log(`  ${rv.voucher_no ?? "(nothing to do)"}   gain/loss Rs ${money(rv.gain_inr)}   over ${(rv.positions || []).length} positions`);
for (const p of rv.positions || [])
  console.log(`    ${String(p.account).padEnd(16)}${String(p.party ?? "the desk").padEnd(22)}${p.currency} ${fx(p.fx).padStart(12)}   Rs ${money(p.was)} -> Rs ${money(p.now)}`);
const [b4] = await tb(); console.log(`  trial balance after revaluing: Rs ${money(b4.dr)} = Rs ${money(b4.cr)}  ${b4.dr === b4.cr ? "AGREES" : "DOES NOT AGREE"}`);

const fy = await t((tx) => tx`select id, fy_code, start_date, end_date, status from ex.fy_period order by start_date`);
sub("financial years");
for (const f of fy) console.log(`  ${f.fy_code}  ${f.start_date.toISOString().slice(0, 10)} to ${f.end_date.toISOString().slice(0, 10)}  ${f.status}`);
const lock = await t(async (tx) => { const [r] = await tx`select ex.fn_lock_fy(${Number(fy[0].id)}, 'Signed off by the CA') as r`; return r.r; });
console.log(`  closing ${lock.fy_code} -> ${lock.status}`);
const blocked = await tryCall("fn_post_voucher", { type: "EXPENSE", date: "2027-03-30",
  narration: "SWIFT charge the CA found missing",
  lines: [{ account_code: "BANK-CHG", fx_amount: "1500", dc: "D" }, { account_code: "CASH-INR", fx_amount: "1500", dc: "C" }] });
console.log(`  posting into the closed year -> ${blocked.ok ? "POSTED (WRONG)" : blocked.message}`);
const tryUnlock = async (id, reason) => {
  try { const r = await t(async (tx) => (await tx`select ex.fn_unlock_fy(${id}, ${reason}) as r`)[0].r); return { ok: true, r }; }
  catch (e) { return { ok: false, message: String(e.message || e).replace(/^error: /, "") }; }
};
let u = await tryUnlock(Number(fy[0].id), "");
console.log(`  reopening with no reason -> ${u.ok ? "REOPENED (WRONG)" : u.message}`);
u = await tryUnlock(Number(fy[0].id), "the CA asked for one more entry");
console.log(`  reopening with a reason  -> ${u.r.status}`);
console.log(`  the note now on the year: ${(await t((tx) => tx`select lock_note from ex.fy_period where id = ${Number(fy[0].id)}`))[0].lock_note}`);
const after = await tryCall("fn_post_voucher", { type: "EXPENSE", date: "2027-03-30",
  narration: "SWIFT charge the CA found missing", reference_no: "BANK-MAR",
  lines: [{ account_code: "BANK-CHG", fx_amount: "1500", dc: "D" }, { account_code: "CASH-INR", fx_amount: "1500", dc: "C" }] });
console.log(`  posting into the reopened year -> ${after.ok ? after.r.voucher_no : after.message}`);

head("THE FINAL PICTURE");
sub("trial balance");
for (const a of await t((tx) => tx`select code, name, debit_inr, credit_inr from ex.v_trial_balance order by code`))
  console.log(`  ${a.code.padEnd(16)}${a.name.padEnd(34)}Dr ${money(a.debit_inr).padStart(14)}   Cr ${money(a.credit_inr).padStart(14)}`);
const [b5] = await tb(); console.log(`  ${"".padEnd(50)}Rs ${money(b5.dr).padStart(14)}   Rs ${money(b5.cr).padStart(14)}  ${b5.dr === b5.cr ? "AGREES" : "DOES NOT AGREE"}`);

await cycles();
const [rc] = await t((tx) => tx`select coalesce(sum(billed_inr - collected_inr),0) a from ex.v_deal_collection`);
const [rr] = await t((tx) => tx`select coalesce(sum(receivable_inr),0) b from ex.v_client_summary`);
console.log(`  uncollected across every deal   Rs ${money(rc.a)}`);
console.log(`  what clients owe, per their own accounts  Rs ${money(rr.b)}   ${Math.abs(Number(rc.a) - Number(rr.b)) < 0.005 ? "AGREES" : "DOES NOT AGREE"}`);

sub("what each depositor has earned the desk");
let totMg = 0, totRt = 0;
for (const d of await t((tx) => tx`select full_name, funded_deals, currency_dealt, cost_of_that,
                                          dealing_margin, rate_gain, total_earned
                                     from ex.v_depositor_profit order by total_earned desc, full_name`)) {
  totMg += Number(d.dealing_margin); totRt += Number(d.rate_gain);
  console.log(`  ${d.full_name.padEnd(18)} ${d.funded_deals} deal(s)  dealt USD ${fx(d.currency_dealt).padStart(12)}`
            + `  margin Rs ${money(d.dealing_margin).padStart(11)}  on the rate Rs ${money(d.rate_gain).padStart(11)}`
            + `  earned Rs ${money(d.total_earned).padStart(11)}`);
}
const [mgAll] = await t((tx) => tx`select coalesce(sum(d.margin_inr),0) m from ex.deal d
                                     join ex.voucher v on v.id = d.voucher_id and v.status = 'POSTED'`);
console.log(`  every depositor's share added up      Rs ${money(totMg)}`);
console.log(`  every deal's margin, counted once     Rs ${money(mgAll.m)}   ${Math.abs(totMg - Number(mgAll.m)) < 0.005 ? "AGREES" : "DOES NOT AGREE"}`);
console.log(`  and on the rate, altogether           Rs ${money(totRt)}`);

sub("profit and loss");
const pl = await t((tx) => tx`select account_type, coalesce(sum(-balance_inr),0) amt from ex.v_account_balance
                               where account_type in ('INCOME','EXPENSE') group by account_type order by account_type`);
const income = Number(pl.find((r) => r.account_type === "INCOME")?.amt ?? 0);
const expense = -Number(pl.find((r) => r.account_type === "EXPENSE")?.amt ?? 0);
console.log(`  earned   Rs ${money(income)}`);
console.log(`  spent    Rs ${money(expense)}`);
console.log(`  PROFIT   Rs ${money(income - expense)}`);

sub("balance sheet");
const bsRows = await t((tx) => tx`select account_type, coalesce(sum(balance_inr),0) amt from ex.v_account_balance
                                   where account_type in ('ASSET','LIABILITY','EQUITY') group by account_type order by account_type`);
const g = (k) => Number(bsRows.find((r) => r.account_type === k)?.amt ?? 0);
console.log(`  what the company holds   Rs ${money(g("ASSET"))}`);
console.log(`  what the company owes    Rs ${money(-g("LIABILITY"))}`);
console.log(`  capital put in           Rs ${money(-g("EQUITY"))}`);
console.log(`  profit so far            Rs ${money(income - expense)}`);
console.log(`  owes + capital + profit  Rs ${money(-g("LIABILITY") - g("EQUITY") + income - expense)}   ${Math.abs(g("ASSET") - (-g("LIABILITY") - g("EQUITY") + income - expense)) < 0.005 ? "SQUARE" : "NOT SQUARE"}`);

sub("what each client owes us and what we owe them");
for (const c of await clientSummary())
  console.log(`  ${c.full_name.padEnd(21)} ${c.deal_count} deal(s)   they owe Rs ${money(c.receivable_inr).padStart(13)}   we owe currency worth Rs ${money(c.currency_payable_inr).padStart(13)}`);
sub("what we owe the depositors");
let owedTot = 0;
for (const d of await depSummary()) { owedTot += Number(d.outstanding_inr);
  console.log(`  ${d.full_name.padEnd(21)} ${d.deposit_count} deposit(s)  brought in USD ${fx(d.currency_brought_in).padStart(12)}   settled Rs ${money(d.total_settled).padStart(13)}   still owed Rs ${money(d.outstanding_inr).padStart(13)}`); }
console.log(`  TOTAL Rs ${money(owedTot)}`);
sub("currency still to deliver");
for (const d of await due()) console.log(`  ${d.full_name.padEnd(21)} ${d.currency_code} ${fx(d.fx_due).padStart(12)}   worth Rs ${money(d.inr_value)}`);
sub("cash and bank");
for (const a of await cash()) console.log(`  ${a.code.padEnd(10)} ${fx(a.balance_fx).padStart(14)}   Rs ${money(a.balance_inr)}`);

sub("every voucher posted, in order");
for (const v of await t((tx) => tx`select voucher_no, to_char(voucher_date,'DD Mon YYYY') d, voucher_type, status,
                                          coalesce(p.full_name,'') party, v.total_inr
                                     from ex.voucher v left join ex.party p on p.id = v.party_id order by v.id`))
  console.log(`  ${v.voucher_no.padEnd(26)}${v.d}  ${v.voucher_type.padEnd(11)}${v.party.padEnd(22)}Rs ${money(v.total_inr).padStart(14)}  ${v.status}`);

head("COUNTS");
console.log(await t((tx) => tx`select (select count(*) from ex.voucher)::int vouchers,
                                      (select count(*) from ex.voucher_line)::int lines,
                                      (select count(*) from ex.deposit)::int deposits,
                                      (select count(*) from ex.deal)::int deals,
                                      (select count(*) from ex.party)::int parties`));
if (!args.includes("--keep")) console.log("\n(company C001 left in place for the document check — rerun to rebuild it)");
await sql.end();
