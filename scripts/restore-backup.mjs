#!/usr/bin/env node
/**
 * Restores an FX Desk company backup ZIP into a database that already has the ex schema
 * (migrations 0000 … 0006 applied) but NOT this company — e.g. a new Supabase project or a
 * local Postgres. Everything runs in ONE transaction. It is a DRY RUN unless --commit is given.
 *
 *   node scripts/restore-backup.mjs <backup.zip> --db <admin connection URL> \
 *        --admin-email girishinindia@gmail.com --admin-password '<temporary password>' [--commit]
 *
 * Steps: verify checksums → check the company / ids are free → load every table (same ids)
 * → move identity sequences forward → check every foreign key → recompute stock, customer and
 * cash balances and compare them with checks/*.csv from the backup → commit or roll back.
 * Password hashes are not in backups: all users get "must change password"; the named Admin
 * gets the temporary password so someone can sign in and reset the others.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { hash } from "@node-rs/argon2";
import { strFromU8, unzipSync } from "fflate";
import postgres from "postgres";

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const zipPath = args.find((a, i) => !a.startsWith("--") && !["--db", "--admin-email", "--admin-password"].includes(args[i - 1]));
const DB = opt("--db") ?? process.env.DATABASE_ADMIN_URL;
const ADMIN_EMAIL = opt("--admin-email");
const ADMIN_PW = opt("--admin-password");
const COMMIT = args.includes("--commit");
if (!zipPath || !DB || !ADMIN_EMAIL || !ADMIN_PW) {
  console.error("Usage: node scripts/restore-backup.mjs <backup.zip> --db <url> --admin-email <email> --admin-password <temp password> [--commit]");
  process.exit(2);
}
if (ADMIN_PW.length < 10) { console.error("--admin-password must be at least 10 characters"); process.exit(2); }

const log = (...a) => console.log(...a);
class DryRun extends Error {}

// same rules as src/lib/csv.ts — the balance check files are compared byte for byte
function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
const toCsv = (rows) => {
  const cols = rows.length ? Object.keys(rows[0]) : [];
  return "﻿" + cols.join(",") + "\r\n" + rows.map((r) => cols.map((k) => csvCell(r[k])).join(",")).join("\r\n") + (rows.length ? "\r\n" : "");
};
const CHECKS = {
  currency_balance: "select * from ex.v_currency_balance order by 1, 2",
  customer_balance: "select * from ex.v_customer_balance order by 1, 2",
  cash_account_balance: "select * from ex.v_cash_account_balance order by 1, 2",
};

// 1. read + verify ------------------------------------------------------------
const files = unzipSync(readFileSync(zipPath));
const m = JSON.parse(strFromU8(files["manifest.json"]));
if (m.format !== "fx-desk-backup/1") throw new Error("Not an FX Desk backup");
for (const e of [...m.tables.flatMap((t) => [t.csv, t.json]), ...m.checks]) {
  if (!files[e.path] || createHash("sha256").update(files[e.path]).digest("hex") !== e.sha256) throw new Error(`Checksum failed: ${e.path}`);
}
log(`Backup OK: ${m.company.name} (${m.company.code}) taken ${m.generated_at} · ${m.total_rows} rows · schema ${m.schema_version}`);
const rowsOf = (t) => strFromU8(files[t.json.path]).split("\n").filter(Boolean).map((l) => JSON.parse(l));

const sql = postgres(DB, { prepare: false, max: 1, onnotice: () => {} });
const cid = m.company.id;
let result;
try {
  await sql.begin(async (tx) => {
    const [{ v }] = await tx`select exists (select 1 from pg_tables where schemaname = 'ex' and tablename = 'backup_log') as v`;
    if (!v) throw new Error("Target database is missing the ex schema or migration 0006");

    // 2. the company and every id must be free ---------------------------------
    const [clash] = await tx`select id, code from ex.company where id = ${cid} or lower(code) = lower(${m.company.code})`;
    if (clash) throw new Error(`Company ${clash.code} (id ${clash.id}) already exists in the target database`);
    for (const t of m.tables) {
      const ids = rowsOf(t).map((r) => r.id).filter((x) => x != null);
      if (!ids.length) continue;
      const [{ n }] = await tx`select count(*)::int as n from ex.${tx(t.name)} where id = any(${ids}::bigint[])`;
      if (n) throw new Error(`${n} id(s) of ex.${t.name} are already used in the target database — restore into an empty project`);
    }

    // 3. load (triggers off: rows keep their original audit columns and timestamps) --
    await tx`set local session_replication_role = replica`;
    const RESET = "!restored-password-reset-required";
    for (const t of m.tables) {
      const target = await tx`
        select a.attname as c, a.attnotnull as nn, a.atthasdef as def
          from pg_attribute a
         where a.attrelid = ${"ex." + t.name}::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
         order by a.attnum`;
      const cols = [];
      const exprs = [];
      for (const { c, nn, def } of target) {
        if (t.columns.includes(c)) { cols.push(c); exprs.push(`r."${c}"`); }
        else if (t.name === "app_user" && c === "password_hash") { cols.push(c); exprs.push(`'${RESET}'`); }
        else if (nn && !def) throw new Error(`ex.${t.name}.${c} is required but not in the backup`);
      }
      const rows = rowsOf(t);
      for (let i = 0; i < rows.length; i += 1000) {
        const batch = rows.slice(i, i + 1000);
        await tx.unsafe(
          `insert into ex."${t.name}" (${cols.map((c) => `"${c}"`).join(", ")}) overriding system value
           select ${exprs.join(", ")} from jsonb_populate_recordset(null::ex."${t.name}", $1::text::jsonb) r`,
          [JSON.stringify(batch)],
        );
      }
      if (rows.length && t.columns.includes("id")) {
        await tx.unsafe(`select setval(pg_get_serial_sequence('ex."${t.name}"', 'id'),
                          greatest((select max(id) from ex."${t.name}"), (select coalesce(last_value, 1) from pg_sequences where schemaname || '.' || sequencename = pg_get_serial_sequence('ex."${t.name}"', 'id'))))`);
      }
      log(`  ex.${t.name.padEnd(18)} ${String(rows.length).padStart(8)} rows`);
    }

    // 4. passwords ---------------------------------------------------------------
    await tx`update ex.app_user set must_change_password = true where company_id = ${cid}`;
    const pw = await hash(ADMIN_PW, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const upd = await tx`update ex.app_user set password_hash = ${pw}, status = 'ACTIVE', failed_login_count = 0
                          where company_id = ${cid} and lower(email) = lower(${ADMIN_EMAIL}) and user_type = 'ADMIN'`;
    if (upd.count !== 1) throw new Error(`${ADMIN_EMAIL} is not an Admin of ${m.company.code} in this backup`);
    await tx`set local session_replication_role = origin`;

    // 5. every foreign key of the restored company must resolve --------------------
    const fks = await tx`
      select c.conname, c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent,
             array(select a.attname from unnest(c.conkey) with ordinality k(n, o) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.o)::text[] as ccols,
             array(select a.attname from unnest(c.confkey) with ordinality k(n, o) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n order by k.o)::text[] as pcols,
             exists (select 1 from pg_attribute a where a.attrelid = c.conrelid and a.attname = 'company_id') as has_cid
        from pg_constraint c where c.contype = 'f' and c.connamespace = 'ex'::regnamespace`;
    let broken = 0;
    for (const f of fks) {
      const notNull = f.ccols.map((c) => `x."${c}" is not null`).join(" and ");
      const match = f.ccols.map((c, i) => `p."${f.pcols[i]}" = x."${c}"`).join(" and ");
      const scope = f.child === "ex.company" ? `x.id = ${cid}` : f.has_cid ? `x.company_id = ${cid}` : "true";
      const [{ n }] = await tx.unsafe(`select count(*)::int as n from ${f.child} x where ${scope} and ${notNull} and not exists (select 1 from ${f.parent} p where ${match})`);
      if (n) { broken += n; log(`  FK ${f.conname}: ${n} broken row(s)`); }
    }
    if (broken) throw new Error(`${broken} row(s) break foreign keys`);
    log(`Foreign keys: all ${fks.length} OK`);

    // 6. balances must be exactly what they were at backup time -------------------
    await tx`select set_config('app.company_id', ${String(cid)}, true), set_config('app.user_id', ${String(m.generated_by.id)}, true)`;
    await tx`set local role ex_app`;
    for (const [name, q] of Object.entries(CHECKS)) {
      const noBom = (x) => x.replace(/^\uFEFF/, "");
      const now = noBom(toCsv(await tx.unsafe(q)));
      const then = noBom(strFromU8(files[`checks/${name}.csv`]));
      if (now !== then) {
        const a = then.split("\r\n"), b = now.split("\r\n");
        const i = a.findIndex((l, k) => l !== b[k]);
        throw new Error(`Balance check ${name} differs after restore\n  backup:   ${a[i]}\n  restored: ${b[i]}`);
      }
      log(`Balance check ${name}: identical`);
    }
    await tx`reset role`;
    result = "ok";
    if (!COMMIT) throw new DryRun();
  });
  log(COMMIT ? `\nRESTORED and committed. Sign in as ${ADMIN_EMAIL} with the temporary password; every user must set a new password.` : "");
} catch (e) {
  if (e instanceof DryRun) log(`\nDRY RUN passed — nothing was saved. Re-run with --commit to restore.`);
  else { console.error(`\nRESTORE FAILED — nothing was saved.\n${e.message}`); process.exitCode = 1; }
} finally {
  await sql.end();
}
if (result !== "ok" && !process.exitCode) process.exitCode = 1;
