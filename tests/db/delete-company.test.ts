/**
 * Erasing a company, and the four things that make that safe to offer at all.
 *
 * Blocking is the everyday answer and is reversible. This is the other one: the test company
 * after sign-off, or an account opened by mistake. It cannot be undone, so what matters is
 * less "does it delete" than:
 *
 *   · it will not touch a company that is still running;
 *   · it will not act on a code the Super Admin did not type out;
 *   · it cannot reach another company's rows — the deletes run as ex_owner, which has no
 *     BYPASSRLS, so the tenant policy scopes every statement to the one company;
 *   · the trail outlives the company it describes.
 *
 * The third is the one worth having a test for: a bug in that SQL should be unable to widen
 * into somebody else's books, and the only way to know is to leave a second company sitting
 * beside the first and count its rows afterwards.
 *
 *   DATABASE_ADMIN_URL — admin connection. Skipped when not set.
 */
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const ADMIN = process.env.DATABASE_ADMIN_URL;
class Rollback extends Error {}
type Tx = postgres.TransactionSql;

const call = async (tx: Tx, fn: string, p: Record<string, unknown>) => {
  try {
    const [r] = await tx<{ v: Record<string, unknown> }[]>`select ex.${tx(fn)}(${tx.json(p as never)}) as v`;
    return r.v;
  } catch (e) { const x = e as Error & { where?: string }; x.message = `${fn}: ${x.message} | where: ${x.where ?? '-'}`; throw x; }
};

const fails = async (tx: Tx, run: (t: Tx) => Promise<unknown>) => {
  try { await tx.savepoint((sp) => run(sp as Tx)); return "ALLOWED"; }
  catch (e) { return String((e as Error).message); }
};

/** A Super Admin, and a company with a person, a party and a posted voucher in it. */
async function company(tx: Tx, tag: string, actor?: number) {
  await tx`reset role`;                  // whatever the last step left behind
  await tx`set local role ex_security`;
  let a = actor;
  if (a === undefined) {
    const [{ id }] = await tx<{ id: string }[]>`
      insert into ex.platform_user (full_name, email, password_hash, must_change_password)
      values (${"Super " + tag}, ${tag + "-" + Date.now() + "@geniusitens.test"}, 'h', false)
      returning id`;
    a = Number(id);
  }
  await tx`set local role ex_platform`;
  const co = await call(tx, "fn_platform_create_company", {
    actor: a, code: "D_" + tag, legal_name: "Delete Test " + tag,
    admin_name: "Admin " + tag, admin_email: `admin-${tag}@test.invalid`,
    admin_password_hash: "h",
  });
  const companyId = Number(co.company_id);
  const adminId = Number(co.admin_id);

  // give it something to lose: set the company up, then a party and an opening voucher
  await tx`set local role ex_app`;
  await tx`select set_config('app.company_id', ${String(companyId)}, true),
                  set_config('app.user_id', ${String(adminId)}, true)`;
  await call(tx, "fn_complete_profile", { full_name: "Admin " + tag });
  await call(tx, "fn_complete_company_setup", { legal_name: "Delete Test " + tag, primary_currency: "USD" });
  const [party] = await tx<{ id: string }[]>`
    insert into ex.party (party_code, full_name, is_depositor)
    values (${"P-" + tag}, ${"Depositor " + tag}, true) returning id`;

  return { actor: a!, companyId, adminId, partyId: Number(party.id) };
}

/** Everything that names a company, counted from outside any tenant context. */
async function rowsFor(tx: Tx, companyId: number) {
  await tx`reset role`;   // the admin connection: nothing is filtered and everything readable
  const [r] = await tx<{ n: string }[]>`
    select ( (select count(*) from ex.company         where id = ${companyId})
           + (select count(*) from ex.app_user        where company_id = ${companyId})
           + (select count(*) from ex.party           where company_id = ${companyId})
           + (select count(*) from ex.account         where company_id = ${companyId})
           + (select count(*) from ex.voucher         where company_id = ${companyId})
           + (select count(*) from ex.voucher_line    where company_id = ${companyId})
           + (select count(*) from ex.voucher_series  where company_id = ${companyId})
           + (select count(*) from ex.fy_period       where company_id = ${companyId})
           + (select count(*) from ex.role            where company_id = ${companyId})
           + (select count(*) from ex.role_permission where company_id = ${companyId})
           + (select count(*) from ex.user_role       where company_id = ${companyId})
           + (select count(*) from ex.company_currency where company_id = ${companyId})
           + (select count(*) from ex.deposit         where company_id = ${companyId})
           + (select count(*) from ex.deal            where company_id = ${companyId})
           + (select count(*) from ex.deal_funding    where company_id = ${companyId})
           + (select count(*) from ex.login_history   where company_id = ${companyId})
           + (select count(*) from ex.backup_log      where company_id = ${companyId})
           + (select count(*) from ex.audit_log       where company_id = ${companyId})
           )::text as n`;
  return Number(r.n);
}

const block = (tx: Tx, actor: number, companyId: number) =>
  call(tx, "fn_platform_set_company_status",
        { actor, company_id: companyId, status: "SUSPENDED", reason: "testing finished" });

describe.skipIf(!ADMIN)("deleting a company", () => {
  const sql = postgres(ADMIN ?? "", { prepare: false, max: 1, onnotice: () => {} });
  afterAll(() => sql.end());

  /**
   * A running company may be blocked and deleted in one act, because making somebody go and
   * block it in a separate trip only reads as a dead end. The part that must hold is that it
   * is still one transaction: a mistyped code has to take the blocking back with it, or a
   * slip of the finger leaves a live desk blocked.
   */
  it("blocks and deletes a running company in one act — and a mistyped code undoes the blocking", async () => {
    const r: Record<string, unknown> = {};
    try {
      await sql.begin(async (tx) => {
        const a = await company(tx, "LIVE");
        await tx`set local role ex_platform`;

        // wrong code, with the flag set: refused, and the company must still be running
        r.mistyped = await fails(tx, (t) => call(t, "fn_platform_delete_company", {
          actor: a.actor, company_id: a.companyId, confirm_code: "D_LIVEX",
          reason: "testing finished here", block_first: true,
        }));
        await tx`reset role`;
        const [c1] = await tx<{ status: string }[]>`select status from ex.company where id = ${a.companyId}`;
        r.statusAfterSlip = c1.status;

        // and without the flag at all, a running company is still refused
        await tx`set local role ex_platform`;
        r.noFlag = await fails(tx, (t) => call(t, "fn_platform_delete_company", {
          actor: a.actor, company_id: a.companyId, confirm_code: "D_LIVE",
          reason: "testing finished here",
        }));

        // right code and the flag: gone
        const out = await call(tx, "fn_platform_delete_company", {
          actor: a.actor, company_id: a.companyId, confirm_code: "d_live",
          reason: "testing finished here", block_first: true,
        });
        r.code = out.code;
        r.left = await rowsFor(tx, a.companyId);

        await tx`set local role ex_security`;
        const [entry] = await tx<{ detail: Record<string, unknown> }[]>`
          select detail from ex.platform_audit where action = 'company.delete' order by id desc limit 1`;
        r.wasRunning = entry.detail.was_running;
        throw new Rollback();
      });
    } catch (e) { if (!(e instanceof Rollback)) throw e; }

    expect(r.mistyped).toMatch(/type the company code/i);
    expect(r.statusAfterSlip).toBe("ACTIVE");        // the slip did not block a live desk
    expect(r.noFlag).toMatch(/Block D_LIVE first/i);
    expect(r.code).toBe("D_LIVE");
    expect(r.left).toBe(0);
    expect(r.wasRunning).toBe(true);                 // the trail says it had been running
  });

  it("refuses a company that is still running, a mistyped code, and no reason", async () => {
    const r: Record<string, string> = {};
    try {
      await sql.begin(async (tx) => {
        const { actor, companyId } = await company(tx, "GUARD");
        await tx`set local role ex_platform`;

        r.running = await fails(tx, (t) => call(t, "fn_platform_delete_company",
          { actor, company_id: companyId, confirm_code: "D_GUARD", reason: "testing finished here" }));

        await block(tx, actor, companyId);

        r.mistyped = await fails(tx, (t) => call(t, "fn_platform_delete_company",
          { actor, company_id: companyId, confirm_code: "D_GUARDD", reason: "testing finished here" }));
        r.noReason = await fails(tx, (t) => call(t, "fn_platform_delete_company",
          { actor, company_id: companyId, confirm_code: "D_GUARD", reason: "done" }));
        r.notSuper = await fails(tx, (t) => call(t, "fn_platform_delete_company",
          { actor: 9_999_999, company_id: companyId, confirm_code: "D_GUARD", reason: "testing finished here" }));
        r.stillThere = String(await rowsFor(tx, companyId));
        throw new Rollback();
      });
    } catch (e) { if (!(e instanceof Rollback)) throw e; }

    expect(r.running).toMatch(/Block D_GUARD first/i);
    expect(r.mistyped).toMatch(/type the company code/i);
    expect(r.noReason).toMatch(/say why/i);
    expect(r.notSuper).toMatch(/super admin/i);
    // four refusals, and not one row was touched by any of them
    expect(Number(r.stillThere)).toBeGreaterThan(0);
  });

  it("removes every row it owns, and leaves the company beside it untouched", async () => {
    const r: Record<string, unknown> = {};
    try {
      await sql.begin(async (tx) => {
        const a = await company(tx, "GOES");
        const b = await company(tx, "STAYS", a.actor);

        r.beforeA = await rowsFor(tx, a.companyId);
        r.beforeB = await rowsFor(tx, b.companyId);

        await tx`set local role ex_platform`;
        await block(tx, a.actor, a.companyId);
        const out = await call(tx, "fn_platform_delete_company", {
          actor: a.actor, company_id: a.companyId,
          confirm_code: "d_goes",                       // lower case on purpose
          reason: "acceptance testing signed off",
        });
        r.code = out.code;
        r.was = out.was;

        r.afterA = await rowsFor(tx, a.companyId);
        r.afterB = await rowsFor(tx, b.companyId);
        throw new Rollback();
      });
    } catch (e) { if (!(e instanceof Rollback)) throw e; }

    expect(r.code).toBe("D_GOES");
    expect(Number(r.beforeA)).toBeGreaterThan(10);   // it really had rows in many tables
    expect(r.afterA).toBe(0);                        // and now it has none, anywhere
    expect(r.afterB).toBe(r.beforeB);                // the one beside it is exactly as it was
    expect(Number(r.beforeB)).toBeGreaterThan(10);
  });

  it("keeps the trail, with the code and the reason, after the company is gone", async () => {
    const r: Record<string, unknown> = {};
    try {
      await sql.begin(async (tx) => {
        const { actor, companyId } = await company(tx, "TRAIL");
        await tx`set local role ex_platform`;
        await block(tx, actor, companyId);
        await call(tx, "fn_platform_delete_company", {
          actor, company_id: companyId, confirm_code: "D_TRAIL",
          reason: "opened by mistake, never used",
        });

        await tx`set local role ex_security`;
        const [row] = await tx<{ action: string; company_id: string | null; detail: Record<string, unknown> }[]>`
          select action, company_id, detail from ex.platform_audit
           where action = 'company.delete' order by id desc limit 1`;
        r.action = row.action;
        r.companyId = row.company_id;          // the company is gone: nothing left to point at
        r.code = row.detail.code;
        r.reason = row.detail.reason;
        r.removed = row.detail.removed;
        throw new Rollback();
      });
    } catch (e) { if (!(e instanceof Rollback)) throw e; }

    expect(r.action).toBe("company.delete");
    expect(r.companyId).toBeNull();
    expect(r.code).toBe("D_TRAIL");
    expect(r.reason).toBe("opened by mistake, never used");
    expect(r.removed).toMatchObject({ people: expect.any(Number), parties: expect.any(Number) });
  });

  /**
   * Found while building the delete, and worth keeping: the trigger that guards the currency
   * on ex.company fires on every update of that row, including one that only changes the
   * status. It used to read ex.voucher inside an `IF a AND EXISTS(...)`, which PL/pgSQL may
   * evaluate whole — so blocking a company could fail with "permission denied for table
   * voucher" depending on the plan, since the console's functions run as ex_security and that
   * role is granted nothing on ex.voucher.
   */
  it("blocking and unblocking never touches ex.voucher, whatever the plan", async () => {
    const r: Record<string, string> = {};
    try {
      await sql.begin(async (tx) => {
        const { actor, companyId } = await company(tx, "GUARDX");
        await tx`set local role ex_platform`;
        for (const [k, status] of [["block", "SUSPENDED"], ["unblock", "ACTIVE"], ["again", "CLOSED"]] as const) {
          r[k] = await fails(tx, (t) => call(t, "fn_platform_set_company_status",
            { actor, company_id: companyId, status, reason: "turning it off and on again" }));
        }
        throw new Rollback();
      });
    } catch (e) { if (!(e instanceof Rollback)) throw e; }

    expect(r.block).toBe("ALLOWED");
    expect(r.unblock).toBe("ALLOWED");
    expect(r.again).toBe("ALLOWED");
  });

  it("the desk's own login cannot delete a company, and the console still cannot read one", async () => {
    const r: Record<string, string> = {};
    try {
      await sql.begin(async (tx) => {
        const { actor, companyId } = await company(tx, "NOPE");

        // the desk's role may not call it at all
        await tx`set local role ex_app`;
        r.desk = await fails(tx, (t) => call(t, "fn_platform_delete_company",
          { actor, company_id: companyId, confirm_code: "D_NOPE", reason: "should never happen" }));
        r.deskPurge = await fails(tx, (t) => t`select ex.fn_purge_company(${companyId})`);

        // and the console, which may, still cannot see what it is deleting
        await tx`set local role ex_platform`;
        r.consoleReads = await fails(tx, (t) => t`select count(*) from ex.voucher`);
        throw new Rollback();
      });
    } catch (e) { if (!(e instanceof Rollback)) throw e; }

    expect(r.desk).toMatch(/permission denied/i);
    expect(r.deskPurge).toMatch(/permission denied/i);
    expect(r.consoleReads).toMatch(/permission denied/i);
  });
});
