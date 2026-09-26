/**
 * The Super Admin tier, against a real database (always rolled back).
 *
 * Two things are being proved here, and they pull in opposite directions:
 *   · a Super Admin can open and close company accounts, which no company user can do;
 *   · a Super Admin cannot see one rupee of any company's trade, which every company user can.
 *
 * The third is the one that makes the whole change worth making: a company's own Administrator
 * can no longer create a user, because the permission that allowed it does not exist any more.
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
/**
 * Run something that must be refused. It goes inside a savepoint: one failed statement
 * poisons a whole Postgres transaction, so without this the first expected refusal would
 * take every later step of the test down with it.
 */
const fails = async (tx: Tx, run: (t: Tx) => Promise<unknown>) => {
  try { await tx.savepoint((sp) => run(sp as Tx)); return "ALLOWED"; }
  catch (e) { return String((e as Error).message); }
};

/** A Super Admin, and a company opened by them. */
async function seed(tx: Tx, tag: string) {
  await tx`set local role ex_security`;
  const [{ actor }] = await tx<{ actor: string }[]>`
    insert into ex.platform_user (full_name, email, password_hash, must_change_password)
    values (${"Super " + tag}, ${tag + "-" + Date.now() + "@geniusitens.test"}, 'hash', false)
    returning id as actor`;

  await tx`set local role ex_platform`;
  const co = await call(tx, "fn_platform_create_company", {
    actor: Number(actor), code: "P_" + tag, legal_name: "Platform Test " + tag,
    admin_name: "First Admin", admin_email: `admin-${tag}@test.invalid`,
    admin_password_hash: "hash", ip: "1.2.3.4",
  });
  return { actor: Number(actor), companyId: Number(co.company_id), adminId: Number(co.admin_id) };
}

/** Become a signed-in user of that company, the way the running app does. */
const asCompanyUser = async (tx: Tx, companyId: number, userId: number) => {
  await tx`set local role ex_app`;
  await tx`select set_config('app.company_id', ${String(companyId)}, true),
                  set_config('app.user_id', ${String(userId)}, true)`;
};

describe.skipIf(!ADMIN)("the Super Admin tier", () => {
  const sql = postgres(ADMIN ?? "", { prepare: false, max: 1, onnotice: () => {} });
  afterAll(() => sql.end());

  /**
   * The code assigns itself. It matters that the number comes from a sequence rather than
   * max()+1: a sequence hands out its value outside the transaction, so two Super Admins
   * opening accounts in the same moment get different codes. It also has to skip anything
   * already taken, because this arrives on databases that already have companies in them.
   */
  it("assigns the company code itself, in order, skipping anything already taken", async () => {
    const r: Record<string, unknown> = {};
    try {
      await sql.begin(async (tx) => {
        await tx`set local role ex_security`;
        const [{ actor }] = await tx<{ actor: string }[]>`
          insert into ex.platform_user (full_name, email, password_hash, must_change_password)
          values ('Super CODE', ${"code-" + Date.now() + "@geniusitens.test"}, 'h', false)
          returning id as actor`;
        const a = Number(actor);

        // wind the sequence to a known place — as the admin connection, because ex_security
        // is granted only what nextval needs and setval is not part of that
        await tx`reset role`;
        await tx`select setval('ex.company_code_seq', 500, true)`;
        await tx`set local role ex_platform`;
        const parked = await call(tx, "fn_platform_create_company", {
          actor: a, code: "C501", legal_name: "Parked", admin_name: "P",
          admin_email: "parked@test.invalid", admin_password_hash: "h",
        });
        r.explicit = parked.company_code;      // an explicit code is still honoured

        // the next two open with no code at all
        const one = await call(tx, "fn_platform_create_company", {
          actor: a, legal_name: "Think NORTH", admin_name: "A",
          admin_email: "a-code@test.invalid", admin_password_hash: "h",
        });
        const two = await call(tx, "fn_platform_create_company", {
          actor: a, legal_name: "Second", admin_name: "B",
          admin_email: "b-code@test.invalid", admin_password_hash: "h",
        });
        r.first = one.company_code;
        r.second = two.company_code;
        throw new Rollback();
      });
    } catch (e) { if (!(e instanceof Rollback)) throw e; }

    expect(r.explicit).toBe("C501");
    // C501 was taken, so the generator stepped over it
    expect(r.first).toBe("C502");
    expect(r.second).toBe("C503");
  });

  it("opens a company with its first Administrator, and refuses the same code twice", async () => {
    const r: Record<string, unknown> = {};
    try {
      await sql.begin(async (tx) => {
        const { actor, companyId } = await seed(tx, "OPEN");

        const [co] = await tx<{ code: string; is_set_up: boolean; admins: number; users: number; status: string }[]>`
          select code, is_set_up, admins, users, status from ex.fn_platform_companies() where id = ${companyId}`;
        r.company = { code: co.code, status: co.status, admins: co.admins, users: co.users };
        // the company arrives NOT set up — its own Administrator has to finish the job
        r.isSetUp = co.is_set_up;

        const [u] = await tx<{ user_type: string; must_change_password: boolean; profile_done: boolean }[]>`
          select user_type, must_change_password, profile_done from ex.fn_platform_users(${companyId})`;
        r.firstAdmin = u;

        r.duplicate = await fails(tx, (t) => call(t, "fn_platform_create_company", {
          actor, code: co.code, legal_name: "Someone else", admin_name: "X",
          admin_email: "x@test.invalid", admin_password_hash: "h",
        }));
        throw new Rollback();
      });
    } catch (e) { if (!(e instanceof Rollback)) throw e; }

    expect(r.company).toMatchObject({ status: "ACTIVE", admins: 1, users: 1 });
    expect(r.isSetUp).toBe(false);
    expect(r.firstAdmin).toEqual({ user_type: "ADMIN", must_change_password: true, profile_done: false });
    expect(r.duplicate).toMatch(/already exists/i);
  });

  it("adds more Administrators and desk users, and will not block the last Administrator", async () => {
    const r: Record<string, unknown> = {};
    try {
      await sql.begin(async (tx) => {
        const { actor, companyId, adminId } = await seed(tx, "PEOPLE");

        const second = await call(tx, "fn_platform_create_user", {
          actor, company_id: companyId, full_name: "Priya Shah",
          email: "priya@test.invalid", user_type: "ADMIN", password_hash: "h",
        });
        await call(tx, "fn_platform_create_user", {
          actor, company_id: companyId, full_name: "Ramesh Desai",
          email: "ramesh@test.invalid", user_type: "USER", password_hash: "h",
        });
        const [co] = await tx<{ admins: number; users: number }[]>`
          select admins, users from ex.fn_platform_companies() where id = ${companyId}`;
        r.counts = co;

        r.sameEmail = await fails(tx, (t) => call(t, "fn_platform_create_user", {
          actor, company_id: companyId, full_name: "Someone", email: "priya@test.invalid",
          user_type: "USER", password_hash: "h",
        }));

        // blocking one of two Administrators is fine; blocking the last one is not
        await call(tx, "fn_platform_set_user_status", { actor, company_id: companyId, user_id: Number(second.user_id), status: "INACTIVE" });
        r.lastAdmin = await fails(tx, (t) => call(t, "fn_platform_set_user_status", { actor, company_id: companyId, user_id: adminId, status: "INACTIVE" }));

        const [after] = await tx<{ admins: number }[]>`select admins from ex.fn_platform_companies() where id = ${companyId}`;
        r.adminsAfter = after.admins;
        throw new Rollback();
      });
    } catch (e) { if (!(e instanceof Rollback)) throw e; }

    expect(r.counts).toEqual({ admins: 2, users: 3 });
    expect(r.sameEmail).toMatch(/already signs in with/i);
    expect(r.lastAdmin).toMatch(/only Administrator/i);
    expect(r.adminsAfter).toBe(1);
  });

  it("blocks a company, with a reason, and lets it back in", async () => {
    const r: Record<string, unknown> = {};
    try {
      await sql.begin(async (tx) => {
        const { actor, companyId } = await seed(tx, "BLOCK");

        r.noReason = await fails(tx, (t) => call(t, "fn_platform_set_company_status", { actor, company_id: companyId, status: "SUSPENDED" }));
        await call(tx, "fn_platform_set_company_status", { actor, company_id: companyId, status: "SUSPENDED", reason: "the invoice is 90 days overdue" });
        const [blocked] = await tx<{ status: string }[]>`select status from ex.fn_platform_companies() where id = ${companyId}`;
        r.blocked = blocked.status;

        await call(tx, "fn_platform_set_company_status", { actor, company_id: companyId, status: "ACTIVE" });
        const [back] = await tx<{ status: string }[]>`select status from ex.fn_platform_companies() where id = ${companyId}`;
        r.back = back.status;

        const log = await tx<{ action: string; detail: Record<string, string> }[]>`
          select action, detail from ex.fn_platform_audit_log(${companyId}) order by id`;
        r.trail = log.map((l) => l.action);
        r.reasonKept = log.find((l) => l.action === "company.block")?.detail.reason;
        throw new Rollback();
      });
    } catch (e) { if (!(e instanceof Rollback)) throw e; }

    expect(r.noReason).toMatch(/Say why/i);
    expect(r.blocked).toBe("SUSPENDED");
    expect(r.back).toBe("ACTIVE");
    expect(r.trail).toEqual(["company.create", "company.block", "company.unblock"]);
    expect(r.reasonKept).toBe("the invoice is 90 days overdue");
  });

  it("a company's own Administrator cannot create a user — the permission no longer exists", async () => {
    const r: Record<string, unknown> = {};
    try {
      await sql.begin(async (tx) => {
        const { companyId, adminId } = await seed(tx, "NOUSER");
        await asCompanyUser(tx, companyId, adminId);

        // the Administrator still holds every permission there is …
        const perms = await tx<{ code: string }[]>`
          select rp.permission_code as code from ex.user_role ur
            join ex.role_permission rp on rp.company_id = ur.company_id and rp.role_id = ur.role_id
           where ur.user_id = ${adminId} order by 1`;
        r.admin = perms.map((p) => p.code);
        // … and neither of the two that used to let them manage people is among them
        r.gone = ["user.manage", "role.manage"].filter((p) => !r.admin!.toString().includes(p));
        r.catalogue = (await tx<{ code: string }[]>`select code from ex.permission where code in ('user.manage','role.manage')`).length;
        r.canSeeOwnPeople = r.admin!.toString().includes("user.view");
        throw new Rollback();
      });
    } catch (e) { if (!(e instanceof Rollback)) throw e; }

    expect(r.gone).toEqual(["user.manage", "role.manage"]);
    expect(r.catalogue).toBe(0);      // not merely ungranted — the codes are gone from the catalogue
    expect(r.canSeeOwnPeople).toBe(true);
  });

  it("a Super Admin cannot reach one rupee of a company's trade", async () => {
    const r: Record<string, unknown> = {};
    try {
      await sql.begin(async (tx) => {
        const { companyId, adminId } = await seed(tx, "BLIND");

        // the company does a day's work
        await asCompanyUser(tx, companyId, adminId);
        await tx`select ex.fn_post_voucher(${tx.json({
          type: "OPENING", date: "2026-04-01",
          lines: [{ account_code: "CASH-INR", fx_amount: "500000", dc: "D" },
                  { account_code: "OB-EQUITY", fx_amount: "500000", dc: "C" }],
        } as never)})`;

        // now look at it as the Super Admin's own database login
        await tx`set local role ex_platform`;
        r.voucher = await fails(tx, (t) => t`select count(*) from ex.voucher`);
        r.lines   = await fails(tx, (t) => t`select count(*) from ex.voucher_line`);
        r.party   = await fails(tx, (t) => t`select count(*) from ex.party`);
        r.company = await fails(tx, (t) => t`select count(*) from ex.company`);
        r.appUser = await fails(tx, (t) => t`select count(*) from ex.app_user`);

        // what they CAN see about that company carries no money at all
        const [co] = await tx<Record<string, unknown>[]>`select * from ex.fn_platform_companies() where id = ${companyId}`;
        r.columns = Object.keys(co).sort();
        throw new Rollback();
      });
    } catch (e) { if (!(e instanceof Rollback)) throw e; }

    for (const k of ["voucher", "lines", "party", "company", "appUser"]) {
      expect(r[k], `ex_platform must not read ex.${k}`).toMatch(/permission denied/i);
    }
    // no balance, no amount, no currency held — only what is needed to run the account
    expect(r.columns).toEqual([
      "admins", "base_currency", "code", "created_at", "id", "is_set_up",
      "last_login_at", "name", "primary_currency", "status", "users",
    ]);
  });

  it("the desk's own connection cannot open a company or reach a Super Admin", async () => {
    const r: Record<string, unknown> = {};
    try {
      await sql.begin(async (tx) => {
        await tx`set local role ex_app`;
        r.register = await fails(tx, (t) => t`select ex.fn_register_company('X', 'X', 'X', 'x@x.invalid', 'x')`);
        r.createCompany = await fails(tx, (t) => t`select ex.fn_platform_create_company('{}'::jsonb)`);
        r.createUser = await fails(tx, (t) => t`select ex.fn_platform_create_user('{}'::jsonb)`);
        r.readSupers = await fails(tx, (t) => t`select count(*) from ex.platform_user`);
        r.readTrail = await fails(tx, (t) => t`select count(*) from ex.platform_audit`);
        throw new Rollback();
      });
    } catch (e) { if (!(e instanceof Rollback)) throw e; }

    for (const [k, v] of Object.entries(r)) {
      expect(v, `ex_app must not be able to: ${k}`).toMatch(/permission denied/i);
    }
  });

  it("a blocked Super Admin can do nothing, even with a valid id", async () => {
    const r: Record<string, unknown> = {};
    try {
      await sql.begin(async (tx) => {
        const { actor, companyId } = await seed(tx, "REVOKED");
        await tx`set local role ex_security`;
        await tx`update ex.platform_user set status = 'INACTIVE' where id = ${actor}`;
        await tx`set local role ex_platform`;
        r.create = await fails(tx, (t) => call(t, "fn_platform_create_user", {
          actor, company_id: companyId, full_name: "Nobody", email: "n@test.invalid",
          user_type: "USER", password_hash: "h",
        }));
        r.block = await fails(tx, (t) => call(t, "fn_platform_set_company_status", {
          actor, company_id: companyId, status: "SUSPENDED", reason: "because",
        }));
        throw new Rollback();
      });
    } catch (e) { if (!(e instanceof Rollback)) throw e; }

    expect(r.create).toMatch(/not active/i);
    expect(r.block).toMatch(/not active/i);
  });

  it("the first Administrator sets the company up, chooses its currency, and it locks", async () => {
    const r: Record<string, unknown> = {};
    try {
      await sql.begin(async (tx) => {
        const { companyId, adminId } = await seed(tx, "SETUP");
        await asCompanyUser(tx, companyId, adminId);

        r.rupees = await fails(tx, (t) => call(t, "fn_complete_company_setup", { legal_name: "Acme", primary_currency: "INR" }));
        r.unknown = await fails(tx, (t) => call(t, "fn_complete_company_setup", { legal_name: "Acme", primary_currency: "ZZZ" }));
        r.noName = await fails(tx, (t) => call(t, "fn_complete_company_setup", { legal_name: "", primary_currency: "USD" }));

        await call(tx, "fn_complete_company_setup", {
          legal_name: "Acme Forex Private Limited", display_name: "Acme Forex",
          primary_currency: "GBP", city: "Surat", gstin: "24AAAAA0000A1Z5",
        });
        const [co] = await tx<{ name: string; prim: string; locked: boolean; done: boolean }[]>`
          select display_name as name, trim(primary_currency_code) as prim,
                 primary_currency_locked as locked, setup_completed_at is not null as done
            from ex.company where id = ${companyId}`;
        r.company = co;
        // the currency they chose has a cash account; the placeholder it arrived with does not
        const accounts = await tx<{ code: string }[]>`select code from ex.account where code like 'CASH-%' order by 1`;
        r.cash = accounts.map((a) => a.code);

        r.twice = await fails(tx, (t) => call(t, "fn_complete_company_setup", { legal_name: "Again", primary_currency: "EUR" }));
        throw new Rollback();
      });
    } catch (e) { if (!(e instanceof Rollback)) throw e; }

    expect(r.rupees).toMatch(/books are kept in/i);
    expect(r.unknown).toMatch(/not a currency/i);
    expect(r.noName).toMatch(/registered name/i);
    expect(r.company).toEqual({ name: "Acme Forex", prim: "GBP", locked: true, done: true });
    expect(r.cash).toEqual(["CASH-GBP", "CASH-INR"]);
    expect(r.twice).toMatch(/already been set up/i);
  });

  it("everybody completes their own profile, and only their own", async () => {
    const r: Record<string, unknown> = {};
    try {
      await sql.begin(async (tx) => {
        const { actor, companyId, adminId } = await seed(tx, "PROFILE");
        const other = await call(tx, "fn_platform_create_user", {
          actor, company_id: companyId, full_name: "Ramesh Desai",
          email: "r@test.invalid", user_type: "USER", password_hash: "h",
        });

        await asCompanyUser(tx, companyId, adminId);
        r.blank = await fails(tx, (t) => call(t, "fn_complete_profile", { full_name: "" }));
        await call(tx, "fn_complete_profile", { full_name: "Anil Mehta", phone: "7720100001" });

        const rows = await tx<{ id: string; full_name: string; phone: string | null; done: boolean }[]>`
          select id, full_name, phone, profile_completed_at is not null as done from ex.app_user order by id`;
        r.me = rows.find((x) => Number(x.id) === adminId);
        r.them = rows.find((x) => Number(x.id) === Number(other.user_id));
        throw new Rollback();
      });
    } catch (e) { if (!(e instanceof Rollback)) throw e; }

    expect(r.blank).toMatch(/full name/i);
    expect(r.me).toEqual({ id: expect.any(String), full_name: "Anil Mehta", phone: "7720100001", done: true });
    // the other person is untouched: finishing your own profile finishes nobody else's
    expect(r.them).toMatchObject({ full_name: "Ramesh Desai", done: false });
  });

  it("one company still cannot see another's people", async () => {
    let seen = "not run";
    try {
      await sql.begin(async (tx) => {
        const a = await seed(tx, "ISOA");
        const b = await seed(tx, "ISOB");
        await asCompanyUser(tx, b.companyId, b.adminId);
        const rows = await tx<{ n: number }[]>`select count(*)::int n from ex.app_user where company_id <> ${b.companyId}`;
        seen = String(rows[0].n) + " of company A's people visible to company B";
        expect(a.companyId).not.toBe(b.companyId);
        throw new Rollback();
      });
    } catch (e) { if (!(e instanceof Rollback)) throw e; }
    expect(seen).toBe("0 of company A's people visible to company B");
  });
});
