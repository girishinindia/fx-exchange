/**
 * Tenant-isolation tests against a real database.
 *
 *   DATABASE_ADMIN_URL  — admin/owner connection (Supabase "postgres" user, or local superuser).
 *                         Used to create two throw-away companies inside a transaction that is
 *                         ALWAYS rolled back, so nothing is left behind.
 *   DATABASE_URL        — the app role (ex_app_login). Optional; enables the app-role checks.
 *
 * Skipped automatically when the variables are not set.  Run:  npm run test:db
 */
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const ADMIN = process.env.DATABASE_ADMIN_URL;
const APP = process.env.DATABASE_URL;

class Rollback extends Error {}

describe.skipIf(!ADMIN)("RLS: a company can only see its own data", () => {
  const sql = postgres(ADMIN ?? "", { prepare: false, max: 1, onnotice: () => {} });
  afterAll(() => sql.end());

  it("isolates reads, writes, references and audit between two companies", async () => {
    const results: Record<string, unknown> = {};
    try {
      await sql.begin(async (tx) => {
        await tx`set local role ex_security`;
        const [{ a }] = await tx`select (ex.fn_register_company('T_A_' || txid_current(), 'Test A', 'Admin A', 'a@test.invalid', 'x')->>'company_id')::bigint as a`;
        const [{ b }] = await tx`select (ex.fn_register_company('T_B_' || txid_current(), 'Test B', 'Admin B', 'b@test.invalid', 'x')->>'company_id')::bigint as b`;
        await tx`set local role ex_owner`; // owner is still subject to FORCE RLS

        // no company in context → nothing visible
        await tx`select set_config('app.company_id', '', true)`;
        results.noContext = (await tx`select count(*)::int n from ex.company`)[0].n;

        // company A writes a customer and updates it
        await tx`select set_config('app.company_id', ${String(a)}, true)`;
        const [{ uid }] = await tx`select id as uid from ex.app_user limit 1`;
        await tx`select set_config('app.user_id', ${String(uid)}, true)`;
        const [{ cid }] = await tx`insert into ex.party (party_code, full_name, phone, is_client) values ('A1', 'Cust A', '111', true) returning id as cid`;
        await tx`update ex.party set phone = '222' where id = ${cid}`;
        results.aSeesCompanies = (await tx`select count(*)::int n from ex.company`)[0].n;
        results.aAuditUpdate = (await tx`select count(*)::int n from ex.audit_log where operation = 'UPDATE' and changed_fields ? 'phone'`)[0].n;

        // company B
        await tx`select set_config('app.company_id', ${String(b)}, true)`;
        results.bSeesACustomers = (await tx`select count(*)::int n from ex.party`)[0].n;
        results.bSeesAAudit = (await tx`select count(*)::int n from ex.audit_log where company_id = ${a}`)[0].n;
        results.bUpdatesA = (await tx`update ex.party set full_name = 'x' where id = ${cid}`).count;

        await tx`savepoint s1`;
        results.bInsertIntoA = await tx`insert into ex.party (company_id, party_code, full_name, is_client) values (${a}, 'X', 'x', true)`.then(() => "allowed", () => "blocked");
        await tx`rollback to savepoint s1`;

        // a user of company A cannot create rows inside company B (composite FK on created_by)
        await tx`savepoint s1b`;
        results.aUserWritesInB = await tx`insert into ex.company_currency (currency_code) values ('EUR')`.then(() => "allowed", () => "blocked");
        await tx`rollback to savepoint s1b`;

        const [{ ubid }] = await tx`select id as ubid from ex.app_user limit 1`;
        await tx`select set_config('app.user_id', ${String(ubid)}, true)`;
        await tx`savepoint s2`;
        results.bReferencesA = await tx`
          select ex.fn_post_voucher(${tx.json({
            type: "RECEIPT", date: "2026-04-01",
            lines: [
              { account_code: "CASH-INR", currency: "INR", fx_amount: "100", rate: "1", dc: "D" },
              { account_code: "CLIENT-REC", party_id: Number(cid), currency: "INR", fx_amount: "100", rate: "1", dc: "C" },
            ],
          } as never)})`.then(() => "allowed", () => "blocked");
        await tx`rollback to savepoint s2`;

        await tx`savepoint s3`;
        results.auditDelete = await tx`delete from ex.audit_log`.then(() => "allowed", () => "blocked");
        await tx`rollback to savepoint s3`;

        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }

    expect(results).toEqual({
      noContext: 0,
      aSeesCompanies: 1,
      aAuditUpdate: 1,
      bSeesACustomers: 0,
      bSeesAAudit: 0,
      bUpdatesA: 0,
      bInsertIntoA: "blocked",
      aUserWritesInB: "blocked",
      bReferencesA: "blocked",
      auditDelete: "blocked",
    });
  });
});

describe.skipIf(!APP)("app role (ex_app_login) is locked down", () => {
  const sql = postgres(APP ?? "", { prepare: false, max: 1, onnotice: () => {} });
  afterAll(() => sql.end());

  it("cannot bypass RLS or call platform functions", async () => {
    const [{ bypass }] = await sql`select rolbypassrls as bypass from pg_roles where rolname = current_user`;
    expect(bypass).toBe(false);
    const companies = await sql.begin((tx) => tx`select count(*)::int n from ex.company`);
    expect(companies[0].n).toBe(0);
    await expect(sql`select ex.fn_register_company('X', 'X', 'X', 'x@x.invalid', 'x')`).rejects.toThrow(/permission denied/);
    await expect(sql`delete from ex.audit_log`).rejects.toThrow(/permission denied/);
  });
});
