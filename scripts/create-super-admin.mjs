#!/usr/bin/env node
/**
 * Creates the first Super Admin — the one account that can open a company.
 *
 * This is the only thing in the whole product that has to be done at a database prompt, and it
 * happens exactly once per installation. Everything afterwards, including adding more Super
 * Admins, is done in the console.
 *
 *   node scripts/create-super-admin.mjs --db <admin URL> --name "Girish Chaudhary" --email girish@geniusitens.com
 *
 * It prints a password to use once. The account is forced to change it at first sign-in.
 */
import { randomInt } from "node:crypto";
import { hash } from "@node-rs/argon2";
import postgres from "postgres";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DB = opt("--db", process.env.DATABASE_ADMIN_URL);
const name = opt("--name");
const email = (opt("--email") || "").trim().toLowerCase();

if (!DB || !name || !email) {
  console.error("Usage: node scripts/create-super-admin.mjs --db <admin URL> --name \"Full Name\" --email you@geniusitens.com");
  process.exit(2);
}
if (!email.includes("@")) { console.error("That does not look like an email address."); process.exit(2); }

const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const block = () => Array.from({ length: 4 }, () => chars[randomInt(chars.length)]).join("");
const password = `Gi-${block()}-${block()}-${randomInt(10, 99)}`;

const sql = postgres(DB, { prepare: false, max: 1, onnotice: () => {} });
try {
  const pwHash = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const [row] = await sql`
    insert into ex.platform_user (full_name, email, password_hash, must_change_password)
    values (${name.trim()}, ${email}, ${pwHash}, true)
    returning id, full_name, email`;

  console.log(`\n  Super Admin created.\n`);
  console.log(`    name      ${row.full_name}`);
  console.log(`    email     ${row.email}`);
  console.log(`    password  ${password}\n`);
  console.log(`  Sign in at  <console address>/platform/login`);
  console.log(`  The password has to be changed straight away — it is written on this screen.\n`);
} catch (e) {
  if (String(e.message).includes("ux_platform_user_email")) {
    console.error(`\n  A Super Admin already uses ${email}.\n`);
  } else {
    console.error(`\n  ${e.message}\n`);
  }
  process.exitCode = 1;
} finally {
  await sql.end();
}
