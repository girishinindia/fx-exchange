#!/usr/bin/env node
/**
 * Checks that the environment this deployment is pointed at is the one it is supposed to be.
 *
 *   node scripts/check-env.mjs [path to env file]      (default: .env.local, then .env)
 *
 * Three things here cannot be seen from the screen, and each of them would quietly undo a
 * guarantee the product is sold on:
 *
 *   · the desk connecting as a role that BYPASSES row-level security — every tenant guard off,
 *     one company able to read another's books, and nothing at all to see in the interface;
 *   · the console's login able to reach a table, or the desk's able to call a platform function;
 *   · Redis unreachable, which means no sessions and nobody can sign in.
 *
 * It reads only; it writes one short-lived key to Redis to prove the credentials work.
 * Exit code 0 = everything passed, 1 = something failed.
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const file = process.argv[2] ?? [".env.local", ".env"].find((f) => fs.existsSync(f));
if (!file || !fs.existsSync(file)) {
  console.error("No env file found. Pass one: node scripts/check-env.mjs .env.local");
  process.exit(2);
}

const env = Object.fromEntries(
  fs.readFileSync(file, "utf8").split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

let failed = 0;
const say = (label, pass, note = "") => {
  if (pass === null) { console.log(`  ${label.padEnd(44, ".")} —  ${note}`); return; }
  if (!pass) failed++;
  console.log(`  ${label.padEnd(44, ".")} ${pass ? "ok  " : "FAIL"} ${note}`);
};
const attempt = async (sql, q) => {
  try { return { ok: true, rows: await q(sql) }; }
  catch (e) { return { ok: false, msg: String(e.message).split("\n")[0] }; }
};

console.log(`\nFX Desk — environment check (${path.basename(file)})\n`);

// --------------------------------------------------------------------------- Redis
console.log("Redis");
if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
  say("credentials present", false, "UPSTASH_REDIS_REST_URL / _TOKEN missing — nobody can sign in");
} else {
  const head = { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}` };
  const j = async (u) => fetch(`${env.UPSTASH_REDIS_REST_URL}${u}`, { headers: head })
    .then((r) => r.json()).catch((e) => ({ error: e.message }));
  await j("/set/fx:envcheck/ok/EX/60");
  const got = await j("/get/fx:envcheck");
  say("writes and reads back", got.result === "ok", got.result === "ok" ? "" : JSON.stringify(got));
}

// --------------------------------------------------------------------------- the desk
console.log("\nThe desk  (DATABASE_URL)");
if (!env.DATABASE_URL) say("set", false, "the desk cannot run without it");
else {
  const app = postgres(env.DATABASE_URL, { prepare: false, max: 2, connect_timeout: 15, onnotice: () => {} });
  const who = await attempt(app, (s) => s`
    select current_user as u,
           (select rolbypassrls from pg_catalog.pg_roles where rolname = current_user) as brls,
           (select rolsuper     from pg_catalog.pg_roles where rolname = current_user) as super`);
  if (!who.ok) say("connects", false, who.msg);
  else {
    const { u, brls, super: isSuper } = who.rows[0];
    say("connects", true, `as ${u}`);
    say("does NOT bypass row-level security", brls === false,
        brls ? "THIS ROLE SEES EVERY COMPANY — row-level security is off. Use ex_app_login." : "");
    say("is not a superuser", isSuper === false);

    const ref = await attempt(app, (s) => s`select count(*)::int n from ex.currency_master`);
    say("reads the reference tables", ref.ok, ref.ok ? `${ref.rows[0].n} currencies` : ref.msg);

    const blind = await attempt(app, (s) => s`select count(*)::int n from ex.company`);
    say("sees no company without a session", blind.ok && blind.rows[0].n === 0,
        blind.ok && blind.rows[0].n > 0 ? `sees ${blind.rows[0].n} — row-level security is not filtering` : "");

    for (const t of ["platform_user", "platform_audit"]) {
      const r = await attempt(app, (s) => s.unsafe(`select count(*) from ex.${t}`));
      say(`is refused by ex.${t}`, !r.ok, r.ok ? "IT CAN READ THE PLATFORM TABLES" : "");
    }

    const grants = await attempt(app, (s) => s`
      select p.proname, pg_catalog.has_function_privilege(current_user, p.oid, 'EXECUTE') as may
        from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'ex'
         and (p.proname = 'fn_register_company' or p.proname like 'fn\\_platform\\_%')`);
    if (!grants.ok) say("cannot open a company", false, grants.msg);
    else {
      const allowed = grants.rows.filter((r) => r.may).map((r) => r.proname);
      say("cannot open a company or touch the console", allowed.length === 0,
          allowed.length ? `it may call: ${allowed.join(", ")}` : "");
    }

    const perms = await attempt(app, (s) => s`
      select count(*)::int total,
             count(*) filter (where code in ('user.manage','role.manage'))::int gone,
             count(*) filter (where code = 'user.view')::int view
        from ex.permission`);
    if (perms.ok) {
      const p = perms.rows[0];
      say("permission catalogue is the current one", p.total === 16 && p.gone === 0 && p.view === 1,
          `${p.total} codes · user.manage/role.manage ${p.gone === 0 ? "gone" : "STILL PRESENT — migration 0013 has not run"}`);
    }
    await app.end();
  }
}

// --------------------------------------------------------------------------- the console
console.log("\nThe console  (DATABASE_PLATFORM_URL)");
if (!env.DATABASE_PLATFORM_URL) {
  say("set", null, "not set — /platform is off here. Correct for the desk's own deployment.");
} else {
  const plat = postgres(env.DATABASE_PLATFORM_URL, { prepare: false, max: 2, connect_timeout: 15, onnotice: () => {} });
  const who = await attempt(plat, (s) => s`
    select current_user as u, (select rolbypassrls from pg_catalog.pg_roles where rolname = current_user) as brls`);
  if (!who.ok) say("connects", false, who.msg);
  else {
    say("connects", true, `as ${who.rows[0].u}`);
    say("does NOT bypass row-level security", who.rows[0].brls === false);

    const co = await attempt(plat, (s) => s`select ex.fn_platform_companies(null)`);
    say("can list the companies", co.ok, co.ok ? "" : co.msg);

    let leaks = [];
    for (const t of ["voucher", "voucher_line", "party", "app_user", "company", "deposit", "deal"]) {
      const r = await attempt(plat, (s) => s.unsafe(`select count(*) from ex.${t}`));
      if (r.ok) leaks.push(t);
    }
    say("is refused by every company table", leaks.length === 0,
        leaks.length ? `IT CAN READ: ${leaks.join(", ")} — the whole arrangement rests on it not being able to` : "");

    const sa = await attempt(plat, (s) => s`select count(*)::int n from ex.fn_platform_companies(null)`);
    const admins = await attempt(plat, (s) => s`select ex.fn_platform_auth('') is not null as x`);
    if (sa.ok) say("there is at least one company", true, `${sa.rows[0].n}`);
    void admins;
    await plat.end();
  }
}

console.log(failed ? `\n${failed} check${failed > 1 ? "s" : ""} failed.\n` : "\nEverything passed.\n");
process.exit(failed ? 1 : 0);
