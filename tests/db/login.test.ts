/**
 * Signing in with an email address or a mobile number, and no company code.
 *
 * Taking the company code out of the sign-in screen moves a burden from the person to the
 * database. The code was what told the software which books to open; without it, whatever the
 * person types has to identify exactly one human being on the whole installation. So the
 * things worth proving here are not really about typing:
 *
 *   · the same number written four different ways is the same person;
 *   · an email address or a mobile number resolves to its owner AND to their one company;
 *   · the same email cannot exist at two companies, and neither can the same mobile number —
 *     because after this change such a pair would have no unambiguous answer;
 *   · a person still cannot reach another company's books by any of this.
 *
 *   DATABASE_ADMIN_URL — admin connection. Skipped when not set.
 */
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const ADMIN = process.env.DATABASE_ADMIN_URL;
class Rollback extends Error {}
type Tx = postgres.TransactionSql;

const call = async (tx: Tx, fn: string, p: Record<string, unknown>) => {
  const [r] = await tx<{ v: Record<string, string> }[]>`select ex.${tx(fn)}(${tx.json(p as never)}) as v`;
  return r.v;
};

/** Run something that must be refused, without poisoning the surrounding transaction. */
const fails = async (tx: Tx, run: (t: Tx) => Promise<unknown>) => {
  try { await tx.savepoint((sp) => run(sp as Tx)); return "ALLOWED"; }
  catch (e) { return String((e as Error).message); }
};

/** A Super Admin, and a company opened by them, with a mobile number on the Administrator. */
async function seed(tx: Tx, tag: string, adminPhone: string | null) {
  await tx`set local role ex_security`;
  const [{ actor }] = await tx<{ actor: string }[]>`
    insert into ex.platform_user (full_name, email, password_hash, must_change_password)
    values (${"Super " + tag}, ${tag + "-" + Date.now() + "@geniusitens.test"}, 'hash', false)
    returning id as actor`;

  await tx`set local role ex_platform`;
  const co = await call(tx, "fn_platform_create_company", {
    actor: Number(actor), code: "L_" + tag, legal_name: "Login Test " + tag,
    admin_name: "First Admin", admin_email: `admin-${tag}@test.invalid`,
    admin_phone: adminPhone, admin_password_hash: "hash", ip: "1.2.3.4",
  });
  return { actor: Number(actor), companyId: Number(co.company_id), adminId: Number(co.admin_id) };
}

const lookup = (tx: Tx, login: string) =>
  tx<{ company_id: string; company_code: string; user_id: string; full_name: string }[]>`
    select * from ex.fn_auth_lookup(${login})`;

describe.skipIf(!ADMIN)("signing in with an email address or a mobile number", () => {
  const sql = postgres(ADMIN ?? "", { prepare: false, max: 1, onnotice: () => {} });
  afterAll(() => sql.end());

  it("treats a number written four ways as the same person, and lower-cases an email", async () => {
    const [r] = await sql<{ a: string; b: string; c: string; d: string; e: string; f: string }[]>`
      select ex.fn_login_key('9662278990')      as a,
             ex.fn_login_key('09662278990')     as b,
             ex.fn_login_key('+91 96622 78990') as c,
             ex.fn_login_key('(966) 227-8990')  as d,
             ex.fn_login_key('  Girish@Example.COM ') as e,
             ex.fn_login_key('   ')             as f`;
    expect(r.a).toBe("9662278990");
    expect(r.b).toBe("9662278990");
    expect(r.c).toBe("9662278990");
    expect(r.d).toBe("9662278990");
    expect(r.e).toBe("girish@example.com");
    expect(r.f).toBeNull();
  });

  it("finds the person and their company from either an email or a mobile", async () => {
    const r: Record<string, unknown> = {};
    try {
      await sql.begin(async (tx) => {
        const { companyId, adminId } = await seed(tx, "FIND", "+91 77010 11111");
        await tx`set local role ex_security`;

        const byEmail = await lookup(tx, "ADMIN-FIND@test.invalid");     // wrong case on purpose
        const byMobile = await lookup(tx, "07701011111");                 // leading zero on purpose
        const bySpaced = await lookup(tx, "+91 77010 11111");
        const unknown = await lookup(tx, "nobody@nowhere.invalid");

        r.byEmail = { n: byEmail.length, company: Number(byEmail[0]?.company_id), user: Number(byEmail[0]?.user_id) };
        r.byMobile = { n: byMobile.length, company: Number(byMobile[0]?.company_id), user: Number(byMobile[0]?.user_id) };
        r.bySpacedUser = Number(bySpaced[0]?.user_id);
        r.unknown = unknown.length;
        r.expected = { company: companyId, user: adminId };
        throw new Rollback();
      });
    } catch (e) { if (!(e instanceof Rollback)) throw e; }

    expect(r.byEmail).toEqual({ n: 1, ...(r.expected as object) });
    expect(r.byMobile).toEqual({ n: 1, ...(r.expected as object) });
    expect(r.bySpacedUser).toBe((r.expected as { user: number }).user);
    expect(r.unknown).toBe(0);
  });

  it("the lookup names the one company that person works for", async () => {
    const r: Record<string, unknown> = {};
    try {
      await sql.begin(async (tx) => {
        const a = await seed(tx, "CO_A", null);
        const b = await seed(tx, "CO_B", null);
        await tx`set local role ex_security`;

        const ra = await lookup(tx, "admin-CO_A@test.invalid");
        const rb = await lookup(tx, "admin-CO_B@test.invalid");
        r.a = { code: ra[0]?.company_code, company: Number(ra[0]?.company_id) };
        r.b = { code: rb[0]?.company_code, company: Number(rb[0]?.company_id) };
        r.expected = { a: a.companyId, b: b.companyId };
        throw new Rollback();
      });
    } catch (e) { if (!(e instanceof Rollback)) throw e; }

    const ex = r.expected as { a: number; b: number };
    expect((r.a as { company: number }).company).toBe(ex.a);
    expect((r.b as { company: number }).company).toBe(ex.b);
    expect((r.a as { code: string }).code).toBe("L_CO_A");
    // two companies, two answers, and neither lookup returned the other's
    expect((r.a as { company: number }).company).not.toBe((r.b as { company: number }).company);
  });

  it("refuses the same email or the same mobile at a second company", async () => {
    const r: Record<string, string> = {};
    try {
      await sql.begin(async (tx) => {
        const first = await seed(tx, "DUP", "9812300001");
        await tx`set local role ex_platform`;

        // a second company whose Administrator would use the first company's email
        r.email = await fails(tx, (t) => call(t, "fn_platform_create_company", {
          actor: first.actor, code: "L_DUP2", legal_name: "Second", admin_name: "Copy Cat",
          admin_email: "admin-DUP@test.invalid", admin_password_hash: "hash",
        }));
        // …and the same again for the mobile number, written differently
        r.mobile = await fails(tx, (t) => call(t, "fn_platform_create_company", {
          actor: first.actor, code: "L_DUP3", legal_name: "Third", admin_name: "Copy Cat",
          admin_email: "someone-else@test.invalid", admin_phone: "+91 98123 00001",
          admin_password_hash: "hash",
        }));
        // adding a person to the SAME company with an address already in use, likewise
        r.person = await fails(tx, (t) => call(t, "fn_platform_create_user", {
          actor: first.actor, company_id: first.companyId, full_name: "Someone",
          email: "admin-DUP@test.invalid", user_type: "USER", password_hash: "hash",
        }));
        r.shortMobile = await fails(tx, (t) => call(t, "fn_platform_create_user", {
          actor: first.actor, company_id: first.companyId, full_name: "Someone",
          email: "fresh@test.invalid", phone: "12345", user_type: "USER", password_hash: "hash",
        }));
        // a genuinely new pair is fine
        r.ok = await fails(tx, (t) => call(t, "fn_platform_create_user", {
          actor: first.actor, company_id: first.companyId, full_name: "Someone New",
          email: "fresh@test.invalid", phone: "9812300002", user_type: "USER", password_hash: "hash",
        }));
        throw new Rollback();
      });
    } catch (e) { if (!(e instanceof Rollback)) throw e; }

    expect(r.email).toMatch(/already signs in with/i);
    expect(r.mobile).toMatch(/already signs in with/i);
    expect(r.person).toMatch(/already signs in with/i);
    expect(r.shortMobile).toMatch(/ten digits/i);
    expect(r.ok).toBe("ALLOWED");
  });

  it("tells the console which company holds the address, and refuses to tell a desk user", async () => {
    const r: Record<string, string> = {};
    try {
      await sql.begin(async (tx) => {
        const first = await seed(tx, "NAMED", "9788800001");
        await tx`set local role ex_platform`;

        // the console is told the registered name and the code — enough to act on
        r.said = await fails(tx, (t) => call(t, "fn_platform_create_company", {
          actor: first.actor, code: "L_NAMED2", legal_name: "Second", admin_name: "Copy Cat",
          admin_email: "admin-NAMED@test.invalid", admin_password_hash: "hash",
        }));
        const [{ who }] = await tx<{ who: string | null }[]>`
          select ex.fn_login_taken('admin-NAMED@test.invalid') as who`;
        r.who = String(who);

        // the desk's own login may not ask the question at all — it is about other companies
        await tx`set local role ex_app`;
        r.desk = await fails(tx, (t) => t`select ex.fn_login_taken('admin-NAMED@test.invalid')`);
        throw new Rollback();
      });
    } catch (e) { if (!(e instanceof Rollback)) throw e; }

    expect(r.who).toBe("Login Test NAMED (L_NAMED)");
    expect(r.said).toContain("Login Test NAMED (L_NAMED)");
    expect(r.said).not.toMatch(/somebody at L_NAMED already/i);   // not the bare code
    expect(r.desk).toMatch(/permission denied/i);
  });

  it("a person setting their own profile cannot take somebody else's mobile number", async () => {
    const r: Record<string, string> = {};
    try {
      await sql.begin(async (tx) => {
        const { actor, companyId, adminId } = await seed(tx, "PROF", "9700000001");
        await tx`set local role ex_platform`;
        const other = await call(tx, "fn_platform_create_user", {
          actor, company_id: companyId, full_name: "Desk Person",
          email: "desk-PROF@test.invalid", user_type: "USER", password_hash: "hash",
        });

        await tx`set local role ex_app`;
        await tx`select set_config('app.company_id', ${String(companyId)}, true),
                        set_config('app.user_id', ${String(other.user_id)}, true)`;

        // the Administrator already signs in with this number
        r.taken = await fails(tx, (t) => call(t, "fn_complete_profile",
          { full_name: "Desk Person", phone: "+91 97000 00001" }));
        // a number of their own is fine
        r.own = await fails(tx, (t) => call(t, "fn_complete_profile",
          { full_name: "Desk Person", phone: "9700000002" }));

        await tx`set local role ex_security`;
        const found = await lookup(tx, "9700000002");
        r.nowFinds = String(Number(found[0]?.user_id) === Number(other.user_id));
        const stillAdmin = await lookup(tx, "9700000001");
        r.adminUntouched = String(Number(stillAdmin[0]?.user_id) === adminId);
        throw new Rollback();
      });
    } catch (e) { if (!(e instanceof Rollback)) throw e; }

    expect(r.taken).toMatch(/already somebody else/i);
    expect(r.own).toBe("ALLOWED");
    expect(r.nowFinds).toBe("true");
    expect(r.adminUntouched).toBe("true");
  });

  it("the sign-in lookup is the only thing that crosses companies — the desk's own login still cannot", async () => {
    const r: Record<string, unknown> = {};
    try {
      await sql.begin(async (tx) => {
        const a = await seed(tx, "ISO_A", null);
        await seed(tx, "ISO_B", null);

        // signed in as company A, the way the app does it
        await tx`set local role ex_app`;
        await tx`select set_config('app.company_id', ${String(a.companyId)}, true),
                        set_config('app.user_id', ${String(a.adminId)}, true)`;

        const [{ n: companies }] = await tx<{ n: string }[]>`select count(*)::text n from ex.company`;
        const [{ n: users }] = await tx<{ n: string }[]>`select count(*)::text n from ex.app_user`;
        r.companies = Number(companies);
        r.users = Number(users);

        // fn_auth_lookup runs as ex_security by design — it has to see every company to find
        // the person. What matters is that it hands back nothing but who they are.
        const cols = await tx<{ c: string }[]>`
          select a.attname as c
            from pg_catalog.pg_proc p
            join pg_catalog.pg_namespace n on n.oid = p.pronamespace
            join unnest(p.proargnames) with ordinality as a(attname, ord) on true
           where n.nspname = 'ex' and p.proname = 'fn_auth_lookup'`;
        r.returns = cols.map((x) => x.c).filter((x) => x !== "p_login");
        throw new Rollback();
      });
    } catch (e) { if (!(e instanceof Rollback)) throw e; }

    // company A sees exactly one company and only its own people
    expect(r.companies).toBe(1);
    expect(r.users).toBe(1);
    // nothing in the lookup's output is money, a party, or another company's anything
    expect(r.returns).toEqual([
      "company_id", "company_code", "company_status", "user_id", "user_type",
      "full_name", "password_hash", "user_status", "locked_until", "must_change_password",
    ]);
  });
});
