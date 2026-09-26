#!/usr/bin/env node
/**
 * LOCAL / STAGING ONLY. Creates company "LOAD" with a year of realistic volume, posted through the
 * real business functions — so the deposits, the deal allocations, the margins and every balance
 * are genuine, not rows shovelled into tables:
 *
 *   3 currencies · 5 desk users · 200 depositors · 1,500 clients
 *   N cycles (default 10,000), each one a deposit, a deal, a payout, a receipt and a settlement
 *
 * then spreads them over the last 365 days so the reports and the date filters have something to
 * chew on.
 *
 *   node scripts/load-test-seed.mjs --db <admin URL> [--cycles 10000] [--password 'Load-Test-2026'] [--reset]
 *
 * Sign in afterwards with company LOAD, admin@load.test and that password.
 */
import { hash } from "@node-rs/argon2";
import postgres from "postgres";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DB = opt("--db", process.env.DATABASE_ADMIN_URL);
const N = Number(opt("--cycles", "10000"));
const PW = opt("--password", "Load-Test-2026");
if (!DB) { console.error("--db <admin URL> is required"); process.exit(2); }
if (/supabase\.(co|com)/.test(DB) && !args.includes("--i-know-this-is-not-production")) {
  console.error("Refusing to seed load data into a Supabase database without --i-know-this-is-not-production");
  process.exit(2);
}

const sql = postgres(DB, { prepare: false, max: 1, onnotice: () => {} });
const t0 = Date.now();
const lap = (m) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s  ${m}`);

if (args.includes("--reset")) {
  // remove an earlier LOAD company completely (test data only)
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    const [c] = await tx`select id from ex.company where code = 'LOAD'`;
    if (c) {
      const order = ["deal_funding", "deal", "deposit", "voucher_line", "voucher", "voucher_series",
                     "fy_period", "account", "party", "user_role", "app_user", "role_permission",
                     "role", "company_currency", "login_history", "backup_log", "audit_log"];
      for (const t of order) await tx`delete from ex.${tx(t)} where company_id = ${c.id}`;
      await tx`delete from ex.company where id = ${c.id}`;
    }
  });
  lap("previous LOAD company removed");
}
const [{ exists }] = await sql`select exists (select 1 from ex.company where code = 'LOAD') as exists`;
if (exists) { console.error("Company LOAD already exists — drop it first or use another database"); process.exit(1); }
const pwHash = await hash(PW, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

let cid, admin, users;
await sql.begin(async (tx) => {
  await tx`set local role ex_security`;
  [{ cid }] = await tx`select (ex.fn_register_company('LOAD', 'Load Test Desk', 'Load Admin', 'admin@load.test', ${pwHash}, 'INR', 'USD')->>'company_id')::bigint as cid`;
  await tx`set local role ex_app`;
  await tx`select set_config('app.company_id', ${String(cid)}, true)`;
  [{ admin }] = await tx`select id as admin from ex.app_user where user_type = 'ADMIN'`;
  await tx`select set_config('app.user_id', ${String(admin)}, true)`;
  await tx`insert into ex.company_currency (currency_code) select unnest(array['EUR','GBP','AED'])`;

  users = [];
  for (let i = 1; i <= 5; i++) {
    const [{ id }] = await tx`insert into ex.app_user (full_name, email, password_hash) values (${"Desk " + i}, ${"u" + i + "@load.test"}, ${pwHash}) returning id`;
    await tx`insert into ex.user_role (user_id, role_id) select ${id}, id from ex.role where code = 'ADMIN'`;
    users.push(id);
  }
  await tx`insert into ex.party (party_code, full_name, phone, city, is_depositor)
           select 'D' || lpad(g::text, 5, '0'), 'Depositor ' || g || ' ' || (array['Traders','Exports','Shah','Patel'])[1 + g % 4],
                  '98' || lpad((10000000 + g * 37)::text, 8, '0'), (array['Surat','Mumbai','Ahmedabad','Vadodara'])[1 + g % 4], true
             from generate_series(1, 200) g`;
  await tx`insert into ex.party (party_code, full_name, phone, city, is_client)
           select 'C' || lpad(g::text, 5, '0'), 'Client ' || g || ' ' || (array['Overseas','Travels','Impex','Tours','Global'])[1 + g % 5],
                  '97' || lpad((10000000 + g * 53)::text, 8, '0'), (array['Surat','Mumbai','Delhi','Pune'])[1 + g % 4], true
             from generate_series(1, 1500) g`;
  // rupees to start with, so receipts and settlements are not blocked on day one
  await tx`select ex.fn_post_voucher(${tx.json({
    type: "OPENING", date: "2026-04-01",
    lines: [{ account_code: "CASH-INR", fx_amount: "50000000", dc: "D" },
            { account_code: "OB-EQUITY", fx_amount: "50000000", dc: "C" }],
  })})`;
});
lap(`company LOAD (id ${cid}) · 5 users · 200 depositors · 1,500 clients · opening capital`);

/**
 * Each cycle is the real thing end to end: a depositor brings USD in at their own rate, a deal
 * spends exactly that deposit for a client, part of the currency goes out, part of the rupees
 * come in, and part of the depositor is settled. Everything goes through the posting functions,
 * so allocation, margin and every guard are exercised exactly as they are in production.
 */
const BATCH = 2000;
for (let done = 0; done < N; done += BATCH) {
  const n = Math.min(BATCH, N - done);
  await sql.begin(async (tx) => {
    await tx`set local role ex_app`;
    await tx`select set_config('app.company_id', ${String(cid)}, true)`;
    await tx.unsafe(`
      do $$
      declare
        v_users bigint[] := array[${users.join(",")}];
        v_curs  text[]   := array['EUR','GBP','AED'];
        -- the billing rate must sit above what a dollar costs (85.50–88.49) once converted,
        -- or the desk sells below cost and the rupee float drains: 0.92 * 96 = 88.3 per dollar,
        -- 0.79 * 112 = 88.5, 3.67 * 24.20 = 88.8 — a margin of about 1%, which is the business
        v_bill  numeric[] := array[96.00, 112.00, 24.20];
        v_conv  numeric[] := array[0.92, 0.79, 3.67];
        v_dep   bigint[] := array(select id from ex.party where is_depositor order by id);
        v_cli   bigint[] := array(select id from ex.party where is_client order by id);
        i int; k int; usd numeric; rate numeric; fx numeric; billed numeric;
        d jsonb; deal jsonb;
      begin
        for i in ${done + 1}..${done + n} loop
          perform set_config('app.user_id', v_users[1 + (i % 5)]::text, true);
          k    := 1 + (i % 3);
          usd  := (2000 + (i * 131) % 18000)::numeric;                 -- USD 2,000 – 20,000
          rate := 85.50 + ((i * 17) % 300) / 100.0;                    -- 85.50 – 88.49
          fx   := round(usd * v_conv[k], 4);
          billed := round(fx * v_bill[k], 2);

          d := ex.fn_post_deposit(jsonb_build_object(
                 'depositor_id', v_dep[1 + (i * 7) % array_length(v_dep, 1)],
                 'date', '2026-04-01'::date, 'fx_amount', usd, 'rate', rate,
                 'reference_no', 'SWIFT-' || i));

          deal := ex.fn_post_deal(jsonb_build_object(
                    'client_id', v_cli[1 + (i * 13) % array_length(v_cli, 1)],
                    'date', '2026-04-01'::date, 'fx_currency', v_curs[k], 'fx_amount', fx,
                    'fx_to_inr_rate', v_bill[k], 'src_amount', usd,
                    'funding', jsonb_build_array(jsonb_build_object('deposit_id', (d->>'id')::bigint, 'fx_allocated', usd))));

          -- two cycles in three are finished off; the rest stay open so the ageing and the
          -- outstanding lists have real work in them
          if i % 3 <> 0 then
            perform ex.fn_post_payout(jsonb_build_object(
              'client_id', v_cli[1 + (i * 13) % array_length(v_cli, 1)],
              'date', '2026-04-01'::date, 'currency', v_curs[k], 'fx_amount', fx));
            perform ex.fn_post_receipt(jsonb_build_object(
              'client_id', v_cli[1 + (i * 13) % array_length(v_cli, 1)],
              'date', '2026-04-01'::date, 'inr_amount', billed));
            perform ex.fn_post_settlement(jsonb_build_object(
              'depositor_id', v_dep[1 + (i * 7) % array_length(v_dep, 1)],
              'date', '2026-04-01'::date, 'inr_amount', round(usd * rate, 2)));
          end if;
        end loop;
      end $$`);
  });
  lap(`${(done + n).toLocaleString("en-IN")} cycles posted`);
}

// Spread over the last 365 days (bypassing triggers: this is test data, not a business action).
await sql.begin(async (tx) => {
  await tx`set local session_replication_role = replica`;
  await tx`
    with d as (select id, (row_number() over (order by id) * 365 / greatest((select count(*) from ex.voucher where company_id = ${cid}), 1))::int as back
                 from ex.voucher where company_id = ${cid})
    update ex.voucher v set voucher_date = v.voucher_date - (365 - d.back),
                            posted_at = v.posted_at - make_interval(days => 365 - d.back)
      from d where v.id = d.id`;
  await tx`update ex.deposit dp set deposit_date = v.voucher_date from ex.voucher v where v.id = dp.voucher_id and dp.company_id = ${cid}`;
  await tx`update ex.deal dl set deal_date = v.voucher_date from ex.voucher v where v.id = dl.voucher_id and dl.company_id = ${cid}`;
});
await sql`analyze`;
lap("dates spread over 365 days · analyzed");

const [s] = await sql`
  select (select count(*) from ex.voucher where company_id = ${cid})      vouchers,
         (select count(*) from ex.voucher_line where company_id = ${cid}) lines,
         (select count(*) from ex.deposit where company_id = ${cid})      deposits,
         (select count(*) from ex.deal where company_id = ${cid})         deals,
         (select count(*) from ex.audit_log where company_id = ${cid})    audit,
         pg_size_pretty(pg_database_size(current_database()))             db_size`;
console.log(s);
await sql.end();
