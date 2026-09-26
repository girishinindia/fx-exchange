/**
 * Tenant-leak suite. Two companies with data in EVERY table; company B then tries to read,
 * change and reference company A's rows through every path the app role has: plain SQL on
 * each table and view, and the posting function called with A's accounts and parties.
 * Plus catalog checks, so a future table or function without RLS / search_path fails here.
 *   DATABASE_ADMIN_URL — admin connection. Always rolled back. Skipped when not set.
 */
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const ADMIN = process.env.DATABASE_ADMIN_URL;
class Rollback extends Error {}
type Tx = postgres.TransactionSql;
const GLOBAL_TABLES = ["currency_master", "permission"]; // reference data shared by all companies
/**
 * The Super Admin's own tables. They have no company_id because a Super Admin belongs to no
 * company, so the tenant rules below cannot apply to them — instead they carry FORCE row-level
 * security with NO policy at all, and ex_app is granted nothing on them. The desk's connection
 * cannot read one row of either, which the two checks further down prove.
 */
const PLATFORM_TABLES = ["platform_user", "platform_audit"];

/** What ex_app may write directly — everything else goes through SECURITY DEFINER functions. */
const APP_WRITES: Record<string, string> = {
  account: "INSERT,UPDATE",
  app_user: "INSERT,UPDATE",
  company: "UPDATE",
  company_currency: "INSERT,UPDATE",
  login_history: "INSERT",
  party: "INSERT,UPDATE",
  role: "DELETE,INSERT,UPDATE",
  role_permission: "DELETE,INSERT",
  user_role: "DELETE,INSERT",
};

type Line = { account_code: string; party_id?: number | string; currency?: string; fx_amount: string; rate?: string; dc: "D" | "C" };
const post = (tx: Tx, type: string, date: string, lines: Line[], extra: Record<string, unknown> = {}) =>
  tx`select ex.fn_post_voucher(${tx.json({ type, date, lines, ...extra } as never)}) as v`;

async function seed(tx: Tx, tag: string) {
  await tx`set local role ex_security`;
  const [{ cid }] = await tx`select (ex.fn_register_company(${"T_L" + tag + "_"} || txid_current(), ${"Leak " + tag}, 'Admin', ${tag + "@test.invalid"}, 'x', 'INR', 'USD')->>'company_id')::bigint as cid`;
  await tx`set local role ex_app`;
  await tx`select set_config('app.company_id', ${String(cid)}, true)`;
  const [{ admin }] = await tx`select id as admin from ex.app_user where user_type = 'ADMIN'`;
  await tx`select set_config('app.user_id', ${String(admin)}, true)`;
  await tx`insert into ex.company_currency (currency_code) values ('EUR')`;
  const [{ dep }] = await tx`insert into ex.party (party_code, full_name, is_depositor) values ('D1', ${"Depositor " + tag}, true) returning id as dep`;
  const [{ cli }] = await tx`insert into ex.party (party_code, full_name, is_client) values ('C1', ${"Client " + tag}, true) returning id as cli`;
  const [{ acc }] = await tx`select id as acc from ex.account where code = 'CASH-USD'`;
  const [{ expense }] = await tx`insert into ex.account (code, name, account_type, account_group) values ('COURIER', 'Courier', 'EXPENSE', 'EXPENSE') returning id as expense`;

  await post(tx, "OPENING", "2026-04-01", [
    { account_code: "CASH-USD", currency: "USD", fx_amount: "1000", rate: "86", dc: "D" },
    { account_code: "OB-EQUITY", currency: "INR", fx_amount: "86000", rate: "1", dc: "C" },
  ]);
  await post(tx, "DEPOSIT", "2026-04-02", [
    { account_code: "CASH-USD", currency: "USD", fx_amount: "1000", rate: "86", dc: "D" },
    { account_code: "DEP-PAY", party_id: dep, currency: "INR", fx_amount: "86000", rate: "1", dc: "C" },
  ], { party_id: dep });
  await post(tx, "DEAL", "2026-04-03", [
    { account_code: "CLIENT-REC", party_id: cli, currency: "INR", fx_amount: "95000", rate: "1", dc: "D" },
    { account_code: "CLIENT-CUR-PAY", party_id: cli, currency: "EUR", fx_amount: "1000", rate: "95", dc: "C" },
    { account_code: "CASH-EUR", currency: "EUR", fx_amount: "1000", rate: "95", dc: "D" },
    { account_code: "CASH-USD", currency: "USD", fx_amount: "1000", rate: "86", dc: "C" },
    { account_code: "FX-MARGIN", currency: "INR", fx_amount: "9000", rate: "1", dc: "C" },
  ], { party_id: cli });
  await tx`insert into ex.login_history (user_id, success) values (${admin}, true)`;
  await tx`select ex.fn_record_backup(${tx.json({ file_name: "x.zip", table_count: 1, row_count: 1, schema_version: "t" })})`;
  const [{ voucher }] = await tx`select id as voucher from ex.voucher order by id desc limit 1`;
  return { cid, admin, dep, cli, acc, expense, voucher };
}

async function fingerprint(tx: Tx, tables: string[]) {
  const out: Record<string, unknown> = {};
  for (const t of tables) out[t] = (await tx`select count(*)::int n from ex.${tx(t)}`)[0].n;
  out.money = (await tx`
    select (select sum(inr_amount)::text from ex.voucher_line) as lines,
           (select string_agg(voucher_no, ',' order by id) from ex.voucher) as vouchers,
           (select string_agg(full_name || coalesce(phone, ''), ',' order by id) from ex.party) as parties`)[0];
  return out;
}

describe.skipIf(!ADMIN)("tenant-leak suite", () => {
  const sql = postgres(ADMIN ?? "", { prepare: false, max: 1, onnotice: () => {} });
  afterAll(() => sql.end());

  it("catalog: forced RLS everywhere, security_invoker views, pinned search_path, no PUBLIC execute", async () => {
    const tables = await sql<{ t: string; rls: boolean; force: boolean; has_cid: boolean; pols: number; bad: number }[]>`
      select c.relname as t, c.relrowsecurity as rls, c.relforcerowsecurity as force,
             exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped) as has_cid,
             (select count(*)::int from pg_policy p where p.polrelid = c.oid) as pols,
             (select count(*)::int from pg_policy p where p.polrelid = c.oid
                and (pg_get_expr(p.polqual, p.polrelid) !~ 'current_company_id' or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), 'x') !~ 'current_company_id')) as bad
        from pg_class c where c.relnamespace = 'ex'::regnamespace and c.relkind in ('r', 'p') order by 1`;
    for (const r of tables) {
      if (GLOBAL_TABLES.includes(r.t)) continue;
      if (PLATFORM_TABLES.includes(r.t)) {
        // locked shut rather than scoped: forced RLS and not a single policy to let anyone in
        expect({ t: r.t, rls: r.rls, force: r.force, pols: r.pols }).toEqual({ t: r.t, rls: true, force: true, pols: 0 });
        continue;
      }
      expect({ t: r.t, rls: r.rls, force: r.force, scoped: r.has_cid || r.t === "company", pols: r.pols > 0, bad: r.bad })
        .toEqual({ t: r.t, rls: true, force: true, scoped: true, pols: true, bad: 0 });
    }

    const views = await sql`select c.relname as v from pg_class c where c.relnamespace = 'ex'::regnamespace and c.relkind in ('v', 'm')
                              and not coalesce(c.reloptions @> array['security_invoker=true'], false)`;
    expect(views.map((v) => v.v)).toEqual([]);

    const fns = await sql`select p.proname as f from pg_proc p where p.pronamespace = 'ex'::regnamespace
                            and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) x where x like 'search_path=%')`;
    expect(fns.map((f) => f.f)).toEqual([]);
    const publicExec = await sql`select p.proname as f from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                  where p.pronamespace = 'ex'::regnamespace and a.grantee = 0 and a.privilege_type = 'EXECUTE'`;
    expect(publicExec.map((f) => f.f)).toEqual([]);
    const appCanOnboard = await sql`select has_function_privilege('ex_app', p.oid, 'execute') as ok from pg_proc p
                                     where p.pronamespace = 'ex'::regnamespace and p.proname = 'fn_register_company'`;
    expect(appCanOnboard.map((x) => x.ok)).toEqual([false]);

    // the desk's connection cannot run one Super Admin function, nor touch either of their tables
    const appOnPlatformFns = await sql<{ f: string }[]>`
      select p.proname as f from pg_proc p where p.pronamespace = 'ex'::regnamespace
         and p.proname like 'fn\\_platform\\_%' and has_function_privilege('ex_app', p.oid, 'execute')`;
    expect(appOnPlatformFns.map((x) => x.f)).toEqual([]);
    const appOnPlatformTables = await sql<{ t: string }[]>`
      select distinct table_name as t from information_schema.role_table_grants
       where table_schema = 'ex' and grantee in ('ex_app', 'ex_app_login', 'PUBLIC')
         and table_name in ('platform_user', 'platform_audit')`;
    expect(appOnPlatformTables.map((x) => x.t)).toEqual([]);

    // and the Super Admin's connection is not a member of the app role, so it reaches no ledger
    const platformOnLedger = await sql<{ t: string }[]>`
      select distinct table_name as t from information_schema.role_table_grants
       where table_schema = 'ex' and grantee = 'ex_platform'`;
    expect(platformOnLedger.map((x) => x.t)).toEqual([]);

    const writes = await sql<{ t: string; p: string }[]>`
      select table_name as t, string_agg(privilege_type, ',' order by privilege_type) as p from information_schema.role_table_grants
       where grantee = 'ex_app' and table_schema = 'ex' and privilege_type <> 'SELECT' group by 1 order by 1`;
    expect(Object.fromEntries(writes.map((w) => [w.t, w.p]))).toEqual(APP_WRITES);

    const [roles] = await sql`select bool_or(rolbypassrls or rolsuper) as any_bypass from pg_roles where rolname in ('ex_app', 'ex_app_login', 'ex_owner')`;
    expect(roles.any_bypass).toBe(false);
    const [pub] = await sql`select has_schema_privilege('public', 'ex', 'usage') as u,
                                   (select count(*)::int from information_schema.role_table_grants where table_schema = 'ex' and grantee = 'PUBLIC') as t`;
    expect(pub).toEqual({ u: false, t: 0 });
    const api = await sql`select r.rolname from pg_roles r where r.rolname in ('anon', 'authenticated') and has_schema_privilege(r.oid, 'ex', 'usage')`;
    expect(api.map((r) => r.rolname)).toEqual([]);
  });

  it("company B cannot read, change or reference any of company A's data", async () => {
    const r: Record<string, unknown> = {};
    try {
      await sql.begin(async (tx) => {
        const A = await seed(tx, "A");
        const B = await seed(tx, "B");
        const tables = (await tx<{ t: string }[]>`select c.relname as t from pg_class c where c.relnamespace = 'ex'::regnamespace and c.relkind = 'r' order by 1`)
          .map((x) => x.t).filter((t) => !GLOBAL_TABLES.includes(t) && !PLATFORM_TABLES.includes(t));
        const views = (await tx<{ v: string }[]>`select c.relname as v from pg_class c where c.relnamespace = 'ex'::regnamespace and c.relkind = 'v' order by 1`).map((x) => x.v);
        const ctx = async (co: typeof A) =>
          tx`select set_config('app.company_id', ${String(co.cid)}, true), set_config('app.user_id', ${String(co.admin)}, true)`;

        await ctx(A);
        const before = await fingerprint(tx, tables);
        r.emptyTablesInA = Object.entries(before).filter(([k, v]) => k !== "money" && v === 0).map(([k]) => k);

        // --- B reads: no row of A anywhere -----------------------------------------
        await ctx(B);
        const seen: string[] = [];
        for (const t of tables) {
          const col = t === "company" ? "id" : "company_id";
          const [{ n }] = await tx`select count(*)::int n from ex.${tx(t)} where ${tx(col)} <> ${B.cid}`;
          if (n) seen.push(t);
        }
        for (const v of views) {
          const hasCid = (await tx`select 1 from information_schema.columns where table_schema = 'ex' and table_name = ${v} and column_name = 'company_id'`).length > 0;
          if (hasCid && (await tx`select count(*)::int n from ex.${tx(v)} where company_id <> ${B.cid}`)[0].n) seen.push(v);
        }
        const [{ foreign }] = await tx`select count(*)::int as foreign from ex.party where full_name = 'Client A'`;
        r.bSeesFromA = [...seen, ...(foreign ? ["party-by-name"] : [])];

        // --- B writes aimed at A's ids ---------------------------------------------
        const attempt = (run: (sp: Tx) => Promise<unknown>) =>
          tx.savepoint(async (sp) => {
            const res = (await run(sp)) as { count?: number } | undefined;
            return res && typeof res.count === "number" && res.count === 0 ? "no rows" : "CHANGED";
          }).then((x) => x, () => "refused");
        r.direct = {
          updateParty: await attempt((sp) => sp`update ex.party set phone = 'hacked' where id = ${A.cli}`),
          updateCompany: await attempt((sp) => sp`update ex.company set legal_name = 'hacked' where id = ${A.cid}`),
          updateUser: await attempt((sp) => sp`update ex.app_user set user_type = 'ADMIN' where id = ${A.admin}`),
          updateAccount: await attempt((sp) => sp`update ex.account set name = 'hacked' where id = ${A.acc}`),
          insertIntoA: await attempt((sp) => sp`insert into ex.party (company_id, party_code, full_name, is_client) values (${A.cid}, 'X', 'x', true)`),
          moveRowToA: await attempt((sp) => sp`update ex.party set company_id = ${A.cid} where id = ${B.cli}`),
          writeVoucherDirectly: await attempt((sp) => sp`insert into ex.voucher (fy_id, voucher_type, voucher_no, voucher_date) values (1, 'JOURNAL', 'X', '2026-04-01')`),
          editOwnVoucher: await attempt((sp) => sp`update ex.voucher set total_inr = 1 where id = ${B.voucher}`),
          deleteOwnLine: await attempt((sp) => sp`delete from ex.voucher_line where voucher_id = ${B.voucher}`),
        };

        // --- B calls the posting function with A's ids -------------------------------
        const fn = (run: (sp: Tx) => Promise<unknown>) => tx.savepoint(run).then(() => "ACCEPTED", () => "refused");
        r.functions = {
          receiptFromAClient: await fn((sp) => post(sp, "RECEIPT", "2026-04-04", [
            { account_code: "CASH-INR", currency: "INR", fx_amount: "100", rate: "1", dc: "D" },
            { account_code: "CLIENT-REC", party_id: A.cli, currency: "INR", fx_amount: "100", rate: "1", dc: "C" },
          ])),
          settlementToADepositor: await fn((sp) => post(sp, "SETTLEMENT", "2026-04-04", [
            { account_code: "DEP-PAY", party_id: A.dep, currency: "INR", fx_amount: "100", rate: "1", dc: "D" },
            { account_code: "CASH-INR", currency: "INR", fx_amount: "100", rate: "1", dc: "C" },
          ])),
          postIntoAsAccount: await fn((sp) => sp`select ex.fn_post_voucher(${sp.json({
            type: "JOURNAL", date: "2026-04-04",
            lines: [
              { account_id: Number(A.expense), currency: "INR", fx_amount: "100", rate: "1", dc: "D" },
              { account_code: "OB-EQUITY", currency: "INR", fx_amount: "100", rate: "1", dc: "C" },
            ],
          } as never)})`),
          readAVoucher: await fn(async (sp) => {
            const rows = await sp`select 1 from ex.voucher where id = ${A.voucher}`;
            if (!rows.length) throw new Error("not visible");
            return rows;
          }),
        };

        // --- control: the same calls with B's own ids work ----------------------------
        r.controls = {
          receiptFromOwnClient: await fn((sp) => post(sp, "RECEIPT", "2026-04-04", [
            { account_code: "CASH-INR", currency: "INR", fx_amount: "100", rate: "1", dc: "D" },
            { account_code: "CLIENT-REC", party_id: B.cli, currency: "INR", fx_amount: "100", rate: "1", dc: "C" },
          ])),
          updateOwnParty: await attempt((sp) => sp`update ex.party set phone = '1' where id = ${B.cli}`),
        };

        // --- A's data unchanged, and no context sees nothing --------------------------
        await ctx(A);
        r.aUnchanged = JSON.stringify(await fingerprint(tx, tables)) === JSON.stringify(before);
        await tx`select set_config('app.company_id', '', true), set_config('app.user_id', '', true)`;
        const empty: string[] = [];
        for (const t of tables) if ((await tx`select count(*)::int n from ex.${tx(t)}`)[0].n) empty.push(t);
        r.noContextSees = empty;
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }

    expect(r.emptyTablesInA).toEqual(["deal", "deal_funding", "deposit"]); // filled by phases 8–9
    expect(r.bSeesFromA).toEqual([]);
    for (const [k, v] of Object.entries(r.direct as Record<string, string>)) expect([k, v]).not.toEqual([k, "CHANGED"]);
    for (const [k, v] of Object.entries(r.functions as Record<string, string>)) expect([k, v]).toEqual([k, "refused"]);
    expect(r.controls).toEqual({ receiptFromOwnClient: "ACCEPTED", updateOwnParty: "CHANGED" });
    expect(r.aUnchanged).toBe(true);
    expect(r.noContextSees).toEqual([]);
  });
});
