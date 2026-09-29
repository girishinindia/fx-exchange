#!/usr/bin/env node
/**
 * LOCAL ONLY. The "Think North — the first month, step by step" tutorial
 * (docs/testing/think-north-tutorial.pdf), run through the real business functions so every
 * figure in the tutorial is what the screen will show. Same idea as company-scenarios.mjs, with
 * the extra kinds of entry the tutorial teaches: a deposit in euros, a deal below cost, a payout
 * in parts, an advance receipt, a duplicate deposit reversed, an expense head added and used,
 * a journal, and the year end.
 *
 *   node scripts/think-north-scenario.mjs --db <admin URL>
 *
 * Output: docs/testing/think-north-run.txt. The company is created as C007 locally and printed
 * as such; the live Think North is C001 — only the prefix differs.
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
const fx = money;

const C = {
  code: "C007", name: "Think North", legal: "Think North Forex Private Limited", city: "Surat",
  admin: ["Girish Chaudhary", "admin@thinknorth.test"], currencies: ["EUR", "GBP", "AED", "SGD"],
  opening: "1000000", openingDate: "2026-10-01",
  depositors: [
    ["Mehta Exports", "9876500011", "Surat"],
    ["Shah Impex", "9876500012", "Ahmedabad"],
    ["Patel Overseas", "9876500013", "Mumbai"],
  ],
  clients: [
    ["Blue Ocean Imports", "9876500021", "Mumbai"],
    ["Sunrise Travels", "9876500022", "Surat"],
    ["Harbour Textiles", "9876500023", "Surat"],
    ["Pearl Diamonds", "9876500024", "Surat"],
    ["Global Edu Consultants", "9876500025", "Vadodara"],
    ["Coral Pharma", "9876500026", "Ahmedabad"],
  ],
  steps: [
    ["head", "PART 5 — THREE DEPOSITORS BRING MONEY IN"],
    ["deposit", "Mehta Exports", "2026-10-02", "USD", "20000", null, "86.00", "SWIFT-TN-1001"],
    ["deposit", "Shah Impex", "2026-10-03", "USD", "15000", null, "86.50", "SWIFT-TN-1002"],
    ["deposit", "Patel Overseas", "2026-10-05", "EUR", "10000", "1.08", "86.40", "SWIFT-TN-1003"],
    ["lines", "SWIFT-TN-1003", "the euro deposit, line by line"],
    ["show", "deposits", "owed", "cash", "cycle"],

    ["head", "PART 6 — SIX CLIENTS BUY CURRENCY"],
    ["deal", "Blue Ocean Imports", "2026-10-06", "EUR", "8000", "93.00", "8600", [["Mehta Exports", 0, "8600"]]],
    ["deal", "Sunrise Travels", "2026-10-07", "GBP", "5000", "110.00", "6300", [["Mehta Exports", 0, "6300"]]],
    ["deal", "Harbour Textiles", "2026-10-08", "AED", "40000", "23.70", "10900", [["Mehta Exports", 0, "5100"], ["Shah Impex", 0, "5800"]]],
    ["funding", 2, "where the dollars for the dirham deal came from — two depositors, two rates"],
    ["deal", "Pearl Diamonds", "2026-10-09", "SGD", "8000", "64.50", "6000", [["Shah Impex", 0, "6000"]]],
    ["lines", "DEAL-4", "the deal below cost, line by line"],
    ["show", "deposits", "clients", "cash", "cycle"],

    ["head", "PART 7 — HANDING THE CURRENCY OVER"],
    ["payout", "Blue Ocean Imports", "2026-10-10", "EUR", "5000"],
    ["payout", "Blue Ocean Imports", "2026-10-11", "EUR", "3000"],
    ["payout", "Sunrise Travels", "2026-10-12", "GBP", "5000"],
    ["payout", "Harbour Textiles", "2026-10-13", "AED", "40000"],
    ["payout", "Pearl Diamonds", "2026-10-14", "SGD", "8000"],
    ["show", "clients", "cash"],

    ["head", "PART 8 — MORE DEPOSITS, AND A DUPLICATE PUT RIGHT"],
    ["deposit", "Mehta Exports", "2026-10-12", "USD", "5000", null, "87.00", "SWIFT-TN-1004"],
    ["deposit", "Shah Impex", "2026-10-13", "USD", "3000", null, "86.50", "SWIFT-TN-1005"],
    ["deposit", "Shah Impex", "2026-10-13", "USD", "3000", null, "86.50", "SWIFT-TN-1005-DUP"],
    ["show", "deposits", "owed"],
    ["reverse", "SWIFT-TN-1005-DUP", "Entered twice — SWIFT-TN-1005 was already recorded"],
    ["show", "deposits", "owed", "cash"],

    ["head", "PART 9 — TWO MORE DEALS"],
    ["deal", "Global Edu Consultants", "2026-10-14", "EUR", "6000", "94.00", "6450", [["Shah Impex", 0, "3200"], ["Patel Overseas", 0, "3250"]]],
    ["deal", "Coral Pharma", "2026-10-15", "GBP", "4000", "111.00", "5050", [["Patel Overseas", 0, "5050"]]],
    ["payout", "Global Edu Consultants", "2026-10-16", "EUR", "6000"],
    ["payout", "Coral Pharma", "2026-10-17", "GBP", "4000"],
    ["deal", "Blue Ocean Imports", "2026-10-20", "EUR", "2000", "93.50", "2150", [["Patel Overseas", 0, "2150"]]],
    ["show", "deposits", "clients", "cash", "cycle"],

    ["head", "PART 10 — COLLECTING THE RUPEES"],
    ["receipt", "Blue Ocean Imports", "2026-10-13", "400000", "NEFT-TN-2001"],
    ["receipt", "Sunrise Travels", "2026-10-14", "550000", "NEFT-TN-2002"],
    ["receipt", "Harbour Textiles", "2026-10-15", "500000", "NEFT-TN-2003"],
    ["receipt", "Pearl Diamonds", "2026-10-16", "516000", "NEFT-TN-2004"],
    ["receipt", "Blue Ocean Imports", "2026-10-18", "344000", "NEFT-TN-2005"],
    ["refuse-receipt", "Global Edu Consultants", "2026-10-19", "570000", "Rs 5,70,000 from Global Edu, who owe Rs 5,64,000, without saying the extra is an advance"],
    ["receipt-advance", "Global Edu Consultants", "2026-10-19", "570000", "NEFT-TN-2006"],
    ["receipt", "Coral Pharma", "2026-10-21", "444000", "NEFT-TN-2007"],
    ["receipt", "Harbour Textiles", "2026-10-22", "448000", "NEFT-TN-2008"],
    ["show", "clients", "cash", "cycle"],

    ["head", "PART 11 — PAYING THE DEPOSITORS BACK"],
    ["settle", "Mehta Exports", "2026-10-23", "10000", "86.00", "NEFT-TN-3001"],
    ["settle", "Mehta Exports", "2026-10-27", "10000", "86.50", "NEFT-TN-3002"],
    ["settle", "Shah Impex", "2026-10-28", "18000", "86.30", "NEFT-TN-3003"],
    ["settle", "Patel Overseas", "2026-10-29", "5000", "86.40", "NEFT-TN-3004"],
    ["show", "owed", "cash", "cycle"],

    ["head", "PART 12 — EXPENSES AND A JOURNAL"],
    ["account", "OFFICE-EXPENSES", "Office Expenses", "EXPENSE", "EXPENSE"],
    ["expense", "2026-10-24", "12500", "OFFICE-EXPENSES", "Courier, stationery and October internet"],
    ["expense", "2026-10-31", "1800", "BANK-CHG", "Bank charges for October — HDFC statement"],
    ["journal", "2026-10-26", "2500", "BANK-CHG", "OFFICE-EXPENSES", "Rs 2,500 of the 24 Oct payment was the bank's SWIFT charge, not office expense"],
    ["show", "cash"],
    ["books", "31 October 2026"],

    ["head", "PART 14 — THE YEAR END"],
    ["positions"],
    ["revalue", "2027-03-31", [["USD", "87.50"], ["EUR", "94.50"]]],
    ["show", "cash", "owed"],
    ["lock", "Books for 2026-27 closed after the CA's review"],
    ["refuse-expense", "2027-03-30", "1500", "posting into the closed year"],
    ["unlock", "CA asked for the March bank charge to be booked"],
    ["expense", "2027-03-30", "1500", "BANK-CHG", "Bank charges for March — found by the CA"],
    ["lock", "Books for 2026-27 closed, second time"],
  ],
};

async function run(c) {
  const out = [];
  const log = (s = "") => out.push(s);
  const head = (t) => log(`\n${"=".repeat(78)}\n${t}\n${"=".repeat(78)}`);
  const sub = (t) => log(`\n--- ${t} ${"-".repeat(Math.max(0, 70 - t.length))}`);

  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    const [row] = await tx`select id from ex.company where code = ${c.code}`;
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
    [{ cid }] = await tx`select (ex.fn_register_company(${c.code}, ${c.name}, ${c.admin[0]}, ${c.admin[1]}, ${pwHash}, 'INR', 'USD')->>'company_id')::bigint as cid`;
    await tx`set local role ex_app`;
    await tx`select set_config('app.company_id', ${String(cid)}, true)`;
    [{ admin }] = await tx`select id as admin from ex.app_user where user_type = 'ADMIN'`;
    await tx`select set_config('app.user_id', ${String(admin)}, true)`;
    await tx`select ex.fn_complete_company_setup(${tx.json({ legal_name: c.legal, display_name: c.name, primary_currency: "USD", city: c.city })})`;
    await tx`insert into ex.company_currency (currency_code) select unnest(${c.currencies}::text[])`;
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

  const party = {};
  await t(async (tx) => {
    const next = async () => (await tx`select 'P-' || lpad((coalesce(max(nullif(regexp_replace(party_code, '\\D', '', 'g'), ''))::bigint, 0) + 1)::text, 5, '0') as code from ex.party`)[0].code;
    for (const [name, phone, city] of c.depositors) {
      const [r] = await tx`insert into ex.party (party_code, full_name, phone, city, is_depositor) values (${await next()}, ${name}, ${phone}, ${city}, true) returning id, party_code`;
      party[name] = r;
    }
    for (const [name, phone, city] of c.clients) {
      const [r] = await tx`insert into ex.party (party_code, full_name, phone, city, is_client) values (${await next()}, ${name}, ${phone}, ${city}, true) returning id, party_code`;
      party[name] = r;
    }
  });

  head(`${c.name.toUpperCase()} — SETTING UP`);
  log(`  company ${c.code}  ${c.name}   admin ${c.admin[1]}   currencies ${c.currencies.join(", ")}`);
  for (const [n] of c.depositors) log(`  depositor  ${party[n].party_code}  ${n}`);
  for (const [n] of c.clients) log(`  client     ${party[n].party_code}  ${n}`);
  const ob = await call("fn_post_voucher", {
    type: "OPENING", date: c.openingDate, narration: `Opening balance as at 1 October 2026`,
    lines: [{ account_code: "CASH-INR", fx_amount: c.opening, dc: "D" }, { account_code: "OB-EQUITY", fx_amount: c.opening, dc: "C" }],
  });
  sub("opening balance"); log(`  ${ob.voucher_no}  ${c.openingDate}  Rs ${money(c.opening)} in rupees`);

  const deposits = {};
  const deals = [];
  const vouchersByRef = {};
  const show = {
    deposits: async () => {
      sub("deposit register");
      for (const d of await t((tx) => tx`select voucher_no, depositor_name, fx_amount, fx_unallocated, manual_rate, inr_amount, status from ex.v_deposit_status order by deposit_id`))
        log(`  ${d.voucher_no}  ${d.depositor_name.padEnd(18)} USD ${fx(d.fx_amount).padStart(10)} @ ${Number(d.manual_rate).toFixed(2)}  unspent ${fx(d.fx_unallocated).padStart(10)}  Rs ${money(d.inr_amount).padStart(13)}${d.status && d.status !== "POSTED" ? "  " + d.status : ""}`);
    },
    owed: async () => {
      sub("what we owe each depositor");
      for (const d of await t((tx) => tx`select full_name, deposit_count, currency_brought_in, total_settled, outstanding_fx, outstanding_inr from ex.v_depositor_summary where deposit_count > 0 or outstanding_fx <> 0 order by full_name`))
        log(`  ${d.full_name.padEnd(18)} ${d.deposit_count} deposit(s)  brought in USD ${fx(d.currency_brought_in)}  paid back Rs ${money(d.total_settled)}  still owed USD ${fx(d.outstanding_fx)}  carried at Rs ${money(d.outstanding_inr)}${Number(d.outstanding_fx) ? `  (${(Number(d.outstanding_inr) / Number(d.outstanding_fx)).toFixed(6)} per USD)` : ""}`);
    },
    cash: async () => {
      sub("cash and bank now");
      for (const r of await t((tx) => tx`select a.code, sum(case when l.dc='D' then l.fx_amount else -l.fx_amount end) as fx, sum(case when l.dc='D' then l.inr_amount else -l.inr_amount end) as inr
            from ex.voucher_line l join ex.account a on a.id = l.account_id where a.code like 'CASH-%' group by a.code
            having sum(case when l.dc='D' then l.fx_amount else -l.fx_amount end) <> 0 or sum(case when l.dc='D' then l.inr_amount else -l.inr_amount end) <> 0 order by a.code`))
        log(`  ${r.code.padEnd(10)} ${fx(r.fx).padStart(14)}   Rs ${money(r.inr).padStart(14)}`);
    },
    cycle: async () => {
      sub("each depositor's money, round the loop");
      for (const y of await t((tx) => tx`select * from ex.v_depositor_cycle where deposit_count > 0 order by full_name`))
        log(`  ${y.full_name.padEnd(18)} ${y.status.padEnd(7)} deposited USD ${fx(y.deposited_fx)} (${y.deposit_count})  dealt ${fx(y.dealt_fx)}  unspent ${fx(y.unspent_fx)}  billed Rs ${money(y.billed_inr)}  collected Rs ${money(y.collected_inr)}  settled USD ${fx(y.settled_fx)}  owed USD ${fx(y.owed_fx)}  earned Rs ${money(y.earned_inr)}`);
    },
    clients: async () => {
      sub("each client — the two tracks");
      for (const k of await t((tx) => tx`select full_name, deal_count, total_billed, total_margin, receivable_inr, currency_payable_inr from ex.v_client_summary where deal_count > 0 order by full_name`))
        log(`  ${k.full_name.padEnd(24)} ${k.deal_count} deal(s)  billed Rs ${money(k.total_billed).padStart(12)}  margin Rs ${money(k.total_margin).padStart(10)}  they owe Rs ${money(k.receivable_inr).padStart(12)}  we owe currency worth Rs ${money(k.currency_payable_inr)}`);
      for (const d of await t((tx) => tx`select full_name, trim(currency_code) as cur, fx_due from ex.v_currency_due where fx_due > 0 order by full_name, currency_code`))
        log(`  still to hand over: ${d.full_name}  ${d.cur} ${fx(d.fx_due)}`);
    },
  };

  for (const step of c.steps) {
    const [kind, ...a] = step;
    if (kind === "head") head(a[0]);
    else if (kind === "show") for (const s of a) await show[s]();
    else if (kind === "deposit") {
      const [name, date, cur, amt, conv, rate, ref] = a;
      const r = await call("fn_post_deposit", { depositor_id: party[name].id, date, currency: cur, fx_amount: amt, to_primary_rate: conv, rate, reference_no: ref });
      (deposits[name] ??= []).push(Number(r.id)); vouchersByRef[ref] = r;
      const how = conv ? `${cur} ${fx(amt)} @ ${conv} -> USD ${fx(r.fx_amount)}` : `USD ${fx(amt)}`;
      log(`  ${r.voucher_no}  ${date}  ${name.padEnd(18)} ${how} @ ${rate}  ->  we owe USD ${fx(r.fx_amount)}, carried at Rs ${money(r.inr_amount)}`);
    } else if (kind === "lines") {
      const [ref, label] = a; sub(label);
      const m = /^DEAL-(\d+)$/.exec(ref);
      const rows = m
        ? await t((tx) => tx`select a.code, l.dc, trim(l.currency_code) as cur, l.fx_amount, l.inr_amount, l.remarks from ex.voucher_line l join ex.account a on a.id = l.account_id join ex.deal d on d.voucher_id = l.voucher_id where d.id = ${Number(deals[Number(m[1]) - 1].id)} order by l.line_no`)
        : await t((tx) => tx`select a.code, l.dc, trim(l.currency_code) as cur, l.fx_amount, l.inr_amount, l.remarks from ex.voucher_line l join ex.account a on a.id = l.account_id join ex.voucher v on v.id = l.voucher_id where v.reference_no = ${ref} order by l.line_no`);
      for (const l of rows) log(`  ${l.code.padEnd(16)}${l.dc}  ${l.cur} ${fx(l.fx_amount).padStart(13)}  Rs ${money(l.inr_amount).padStart(12)}   ${l.remarks ?? ""}`);
    } else if (kind === "deal") {
      const [name, date, cur, amt, rate, src, funding] = a;
      const r = await call("fn_post_deal", { client_id: party[name].id, date, fx_currency: cur, fx_amount: amt, fx_to_inr_rate: rate, src_amount: src,
        funding: funding.map(([dn, i, al]) => ({ deposit_id: deposits[dn][i], fx_allocated: al })) });
      deals.push(r);
      log(`  ${r.voucher_no}  ${date}  ${name.padEnd(24)} ${cur} ${fx(amt).padStart(10)} @ ${rate}  spends USD ${fx(src)}  billed Rs ${money(r.billed_inr)}  cost Rs ${money(r.src_cost_inr)}  ${Number(r.margin_inr) < 0 ? "LOSS" : "margin"} Rs ${money(Math.abs(r.margin_inr))}`);
      const f = await t((tx) => tx`select s.voucher_no, s.depositor_name, f.fx_allocated, f.manual_rate, f.cost_inr from ex.deal_funding f join ex.v_deposit_status s on s.deposit_id = f.deposit_id where f.deal_id = ${Number(r.id)} order by f.deposit_id`);
      for (const x of f) log(`      taken ${fx(x.fx_allocated).padStart(10)} from ${x.voucher_no} (${x.depositor_name}) @ ${Number(x.manual_rate).toFixed(2)} = Rs ${money(x.cost_inr)}`);
    } else if (kind === "funding") {
      const [i, label] = a; sub(label);
      for (const f of await t((tx) => tx`select s.voucher_no, s.depositor_name, f.fx_allocated, f.manual_rate, f.cost_inr from ex.deal_funding f join ex.v_deposit_status s on s.deposit_id = f.deposit_id where f.deal_id = ${Number(deals[i].id)} order by f.deposit_id`))
        log(`  ${f.voucher_no}  ${f.depositor_name.padEnd(18)} USD ${fx(f.fx_allocated)} @ ${Number(f.manual_rate).toFixed(2)}  = Rs ${money(f.cost_inr)}`);
    } else if (kind === "payout") {
      const [name, date, cur, amt] = a;
      const r = await call("fn_post_payout", { client_id: party[name].id, date, currency: cur, fx_amount: amt });
      log(`  ${r.voucher_no}  ${date}  ${name.padEnd(24)} handed over ${cur} ${fx(amt)}  was owed ${fx(r.was_due_fx)}  now owed ${fx(r.now_due_fx)}  (exchange difference Rs ${money(r.gain_inr)})`);
    } else if (kind === "receipt" || kind === "receipt-advance") {
      const [name, date, amt, ref] = a;
      const r = await call("fn_post_receipt", { client_id: party[name].id, date, inr_amount: amt, reference_no: ref, allow_advance: kind === "receipt-advance" });
      log(`  ${r.voucher_no}  ${date}  ${name.padEnd(24)} took Rs ${money(amt)}  was owed Rs ${money(r.was_owed)}  now owed Rs ${money(r.now_owed)}${Number(r.advance_inr) ? `  ADVANCE Rs ${money(r.advance_inr)}` : ""}`);
    } else if (kind === "refuse-receipt") {
      const [name, date, amt, label] = a;
      const r = await tryCall("fn_post_receipt", { client_id: party[name].id, date, inr_amount: amt });
      log(`  ${r.ok ? "!! ALLOWED" : "refused"}  ${label}\n             -> ${r.ok ? JSON.stringify(r.r) : r.message}`);
    } else if (kind === "settle") {
      const [name, date, amt, rate, ref] = a;
      const r = await call("fn_post_settlement", { depositor_id: party[name].id, date, currency: "USD", fx_amount: amt, rate, reference_no: ref });
      const g = Number(r.gain_inr);
      log(`  ${r.voucher_no}  ${date}  ${name.padEnd(18)} USD ${fx(amt)} @ ${rate}  paid Rs ${money(r.inr_amount)}  released Rs ${money(r.released_inr)} (carried ${Number(r.carried_at).toFixed(6)})  ${g > 0 ? "gain" : g < 0 ? "LOSS" : "no difference"} Rs ${money(Math.abs(g))}  still owed USD ${fx(r.now_owed_fx)}`);
    } else if (kind === "reverse") {
      const [ref, reason] = a; const v = vouchersByRef[ref];
      const [vv] = await t((tx) => tx`select id from ex.voucher where reference_no = ${ref}`);
      const r = await t(async (tx) => (await tx`select ex.fn_reverse_voucher(${Number(vv.id)}, ${reason}) as r`)[0].r);
      log(`  reversing ${v.voucher_no} — "${reason}"\n  -> ${r.voucher_no}  the mirror, Rs ${money(r.total_inr ?? v.inr_amount)}; the original now reads REVERSED`);
    } else if (kind === "account") {
      const [code, name, type, group] = a;
      const [r] = await t((tx) => tx`insert into ex.account (code, name, account_type, account_group, sort_order) values (${code}, ${name}, ${type}, ${group}, 70) returning code, name`);
      log(`  account added: ${r.code}  ${r.name}  (${group.toLowerCase()} head)`);
    } else if (kind === "books") {
      sub(`the books on ${a[0]}`);
      for (const r of await t((tx) => tx`select code, name, debit_inr, credit_inr from ex.v_trial_balance where debit_inr <> 0 or credit_inr <> 0 order by code`))
        log(`  ${r.code.padEnd(16)}${r.name.padEnd(34)}${Number(r.debit_inr) ? "Dr" : "Cr"} Rs ${money(Number(r.debit_inr) || Number(r.credit_inr)).padStart(14)}`);
      const [bb] = await t((tx) => tx`select coalesce(sum(debit_inr),0) dr, coalesce(sum(credit_inr),0) cr from ex.v_trial_balance`);
      log(`  trial balance: Rs ${money(bb.dr)} = Rs ${money(bb.cr)}  ${Number(bb.dr) === Number(bb.cr) ? "AGREES" : "DOES NOT AGREE"}`);
      const pl2 = await t((tx) => tx`select a.code, a.name, a.account_type, sum(case when l.dc='C' then l.inr_amount else -l.inr_amount end) as cr
        from ex.voucher_line l join ex.account a on a.id = l.account_id where a.account_type in ('INCOME','EXPENSE') group by a.code, a.name, a.account_type having sum(l.inr_amount) <> 0 order by a.account_type desc, a.code`);
      let e2 = 0, s2 = 0;
      for (const r of pl2) { const v = Number(r.cr); if (r.account_type === "INCOME") e2 += v; else s2 -= v; log(`  P&L ${r.code.padEnd(12)} Rs ${money(Math.abs(v))}`); }
      log(`  earned Rs ${money(e2)}   spent Rs ${money(s2)}   PROFIT Rs ${money(e2 - s2)}`);
      const [cnt] = await t((tx) => tx`select count(*) as n from ex.voucher`);
      log(`  vouchers so far: ${cnt.n}`);
    } else if (kind === "positions") {
      sub("the open positions the year-end screen shows");
      for (const p of await t((tx) => tx`select trim(currency_code) as cur, balance_fx, balance_inr from ex.v_currency_position where balance_fx <> 0 order by 1`))
        log(`  ${p.cur}  held ${fx(p.balance_fx).padStart(12)}  Rs ${money(p.balance_inr)}  carried at Rs ${(Number(p.balance_inr) / Number(p.balance_fx)).toFixed(6)}`);
      for (const d of await t((tx) => tx`select full_name, trim(currency_code) as cur, fx_due, inr_value from ex.v_currency_due order by full_name`))
        log(`  owed to client ${d.full_name}: ${d.cur} ${fx(d.fx_due)} worth Rs ${money(d.inr_value)}`);
      for (const d of await t((tx) => tx`select full_name, trim(currency_code) as cur, fx_due, inr_value from ex.v_depositor_due order by full_name`))
        log(`  owed to depositor ${d.full_name}: ${d.cur} ${fx(d.fx_due)} carried at Rs ${money(d.inr_value)}`);
    } else if (kind === "revalue") {
      const [date, rates] = a; const RATES = rates.map(([currency, rate]) => ({ currency, rate }));
      sub(`revaluing at the closing rates ${RATES.map((r) => `${r.currency} ${r.rate}`).join(", ")}`);
      const rv = await call("fn_revalue_currency", { date, rates: RATES });
      log(`  ${rv.voucher_no ?? "(nothing to do)"}   gain/loss Rs ${money(rv.gain_inr)}   over ${(rv.positions || []).length} positions`);
      for (const p of rv.positions || []) log(`    ${String(p.account).padEnd(16)}${String(p.party ?? "the desk").padEnd(24)}${p.currency} ${fx(p.fx).padStart(12)}   Rs ${money(p.was)} -> Rs ${money(p.now)}`);
    } else if (kind === "lock" || kind === "unlock") {
      const [reason] = a;
      const fy = await t((tx) => tx`select id, fy_code, status from ex.fy_period order by start_date`);
      await t(async (tx) => (await tx`select ex.${tx(kind === "lock" ? "fn_lock_fy" : "fn_unlock_fy")}(${Number(fy[0].id)}, ${reason}) as r`)[0].r);
      const after = await t((tx) => tx`select status, lock_note from ex.fy_period where id = ${Number(fy[0].id)}`);
      log(`  ${kind} ${fy[0].fy_code} — "${reason}" -> status ${after[0].status}${after[0].lock_note ? `; note: ${after[0].lock_note}` : ""}`);
    } else if (kind === "refuse-expense") {
      const [date, amt, label] = a;
      const r = await tryCall("fn_post_voucher", { type: "EXPENSE", date, narration: label, lines: [{ account_code: "BANK-CHG", fx_amount: amt, dc: "D" }, { account_code: "CASH-INR", fx_amount: amt, dc: "C" }] });
      log(`  ${r.ok ? "!! ALLOWED" : "refused"}  ${label}\n             -> ${r.ok ? JSON.stringify(r.r) : r.message}`);
    } else if (kind === "expense") {
      const [date, amt, acct, label] = a;
      const r = await tryCall("fn_post_voucher", { type: "EXPENSE", date, narration: label, lines: [{ account_code: acct, fx_amount: amt, dc: "D" }, { account_code: "CASH-INR", fx_amount: amt, dc: "C" }] });
      log(`  ${r.ok ? r.r.voucher_no : "REFUSED: " + r.message}  ${date}  Rs ${money(amt)}  Dr ${acct} / Cr CASH-INR — ${label}`);
    } else if (kind === "journal") {
      const [date, amt, dr, cr, label] = a;
      const r = await tryCall("fn_post_voucher", { type: "JOURNAL", date, narration: label, lines: [{ account_code: dr, fx_amount: amt, dc: "D" }, { account_code: cr, fx_amount: amt, dc: "C" }] });
      log(`  ${r.ok ? r.r.voucher_no : "REFUSED: " + r.message}  ${date}  Rs ${money(amt)}  Dr ${dr} / Cr ${cr} — ${label}`);
    }
  }

  head("DO THE BOOKS AGREE");
  sub("trial balance");
  for (const r of await t((tx) => tx`select code, name, debit_inr, credit_inr from ex.v_trial_balance where debit_inr <> 0 or credit_inr <> 0 order by code`))
    log(`  ${r.code.padEnd(16)}${r.name.padEnd(34)}${Number(r.debit_inr) ? "Dr" : "Cr"} Rs ${money(Number(r.debit_inr) || Number(r.credit_inr)).padStart(14)}`);
  const [b] = await t((tx) => tx`select coalesce(sum(debit_inr),0) dr, coalesce(sum(credit_inr),0) cr from ex.v_trial_balance`);
  log(`  trial balance: Rs ${money(b.dr)} = Rs ${money(b.cr)}  ${Number(b.dr) === Number(b.cr) ? "AGREES" : "DOES NOT AGREE"}`);
  sub("profit and loss");
  const pl = await t((tx) => tx`select a.code, a.name, a.account_type, sum(case when l.dc='C' then l.inr_amount else -l.inr_amount end) as cr
        from ex.voucher_line l join ex.account a on a.id = l.account_id where a.account_type in ('INCOME','EXPENSE') group by a.code, a.name, a.account_type having sum(l.inr_amount) <> 0 order by a.account_type desc, a.code`);
  let earned = 0, spent = 0;
  for (const r of pl) { const v = Number(r.cr); if (r.account_type === "INCOME") earned += v; else spent -= v;
    log(`  ${r.code.padEnd(16)}${r.name.padEnd(34)}Rs ${money(Math.abs(v)).padStart(12)} (${r.account_type.toLowerCase()})`); }
  log(`  earned Rs ${money(earned)}   spent Rs ${money(spent)}   PROFIT Rs ${money(earned - spent)}`);
  sub("balance sheet");
  const bs = await t((tx) => tx`select a.account_type, a.code, a.name, sum(case when l.dc='D' then l.inr_amount else -l.inr_amount end) as dr
        from ex.voucher_line l join ex.account a on a.id = l.account_id where a.account_type in ('ASSET','LIABILITY','EQUITY') group by a.account_type, a.code, a.name having sum(case when l.dc='D' then l.inr_amount else -l.inr_amount end) <> 0 order by a.account_type, a.code`);
  let assets = 0, liab = 0, eq = 0;
  for (const r of bs) { const v = Number(r.dr); if (r.account_type === "ASSET") assets += v; else if (r.account_type === "LIABILITY") liab -= v; else eq -= v;
    log(`  ${r.account_type.padEnd(10)}${r.code.padEnd(16)}${r.name.padEnd(30)}Rs ${money(Math.abs(v)).padStart(14)}`); }
  log(`  holdings Rs ${money(assets)} = owed to others Rs ${money(liab)} + own Rs ${money(eq)} + profit Rs ${money(earned - spent)}  ->  Rs ${money(liab + eq + earned - spent)}  ${Math.abs(assets - (liab + eq + earned - spent)) < 0.005 ? "SQUARE" : "NOT SQUARE"}`);
  sub("what each depositor has earned the desk");
  for (const p of await t((tx) => tx`select full_name, funded_deals, currency_dealt, dealing_margin, rate_gain, total_earned from ex.v_depositor_profit where funded_deals > 0 or rate_gain <> 0 order by full_name`))
    log(`  ${p.full_name.padEnd(18)} ${p.funded_deals} deal(s)  dealt USD ${fx(p.currency_dealt)}  margin Rs ${money(p.dealing_margin)}  on the rate Rs ${money(p.rate_gain)}  earned Rs ${money(p.total_earned)}`);
  sub("each client, at the end");
  for (const k of await t((tx) => tx`select full_name, deal_count, total_billed, total_margin, receivable_inr, currency_payable_inr from ex.v_client_summary where deal_count > 0 order by full_name`))
    log(`  ${k.full_name.padEnd(24)} ${k.deal_count} deal(s)  billed Rs ${money(k.total_billed).padStart(12)}  margin Rs ${money(k.total_margin).padStart(10)}  they owe Rs ${money(k.receivable_inr).padStart(12)}  we owe currency worth Rs ${money(k.currency_payable_inr)}`);
  sub("every voucher posted, in order");
  for (const v of await t((tx) => tx`select v.voucher_no, to_char(v.voucher_date,'DD Mon YYYY') as d, v.voucher_type, p.full_name, v.total_inr, v.status from ex.voucher v left join ex.party p on p.id = v.party_id order by v.id`))
    log(`  ${v.voucher_no.padEnd(27)} ${v.d}  ${v.voucher_type.padEnd(12)}${(v.full_name ?? "").padEnd(24)} Rs ${money(v.total_inr).padStart(13)}  ${v.status}`);
  const [n] = await t((tx) => tx`select (select count(*) from ex.voucher) as vouchers, (select count(*) from ex.voucher_line) as lines`);
  log(`\n  ${n.vouchers} vouchers, ${n.lines} lines`);

  const file = `docs/testing/think-north-run.txt`;
  writeFileSync(file, out.join("\n") + "\n");
  console.log(`${c.name}: ${n.vouchers} vouchers, profit Rs ${money(earned - spent)}, trial balance ${Number(b.dr) === Number(b.cr) ? "agrees" : "DOES NOT AGREE"} -> ${file}`);
}

await run(C);
await sql.end();
