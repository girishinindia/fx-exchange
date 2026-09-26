/**
 * Company backup against a real database (rolled back): complete, checksummed, only the
 * company's own rows, no password hashes, and the verify script accepts it.
 *   DATABASE_ADMIN_URL — admin connection. Skipped when not set.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { backupTables, countRows, writeBackup, type Manifest } from "@/lib/backup";

const ADMIN = process.env.DATABASE_ADMIN_URL;
class Rollback extends Error {}

describe.skipIf(!ADMIN)("company backup", () => {
  const sql = postgres(ADMIN ?? "", { prepare: false, max: 1, onnotice: () => {} });
  afterAll(() => sql.end());

  it("writes a complete, verifiable ZIP with only this company's data", async () => {
    const chunks: Uint8Array[] = [];
    let manifest!: Manifest;
    let recorded = 0;
    let recordDenied = "";
    try {
      await sql.begin(async (tx) => {
        await tx`set local role ex_security`;
        const [{ a }] = await tx`select (ex.fn_register_company('T_BA_' || txid_current(), 'Backup A', 'Admin A', 'a@test.invalid', 'x', 'INR', 'USD')->>'company_id')::bigint as a`;
        const [{ b }] = await tx`select (ex.fn_register_company('T_BB_' || txid_current(), 'Backup B', 'Admin B', 'b@test.invalid', 'x', 'INR', 'USD')->>'company_id')::bigint as b`;
        await tx`set local role ex_app`;

        // company B has a party that must never appear in A's backup
        await tx`select set_config('app.company_id', ${String(b)}, true)`;
        const [{ ub }] = await tx`select id as ub from ex.app_user limit 1`;
        await tx`select set_config('app.user_id', ${String(ub)}, true)`;
        await tx`insert into ex.party (party_code, full_name, phone, is_client) values ('B1', 'SECRET-B', '9', true)`;

        await tx`select set_config('app.company_id', ${String(a)}, true)`;
        const [{ ua }] = await tx`select id as ua from ex.app_user where user_type = 'ADMIN'`;
        await tx`select set_config('app.user_id', ${String(ua)}, true)`;
        await tx`insert into ex.party (party_code, full_name, phone, is_client) values ('A1', '=cmd|calc, "quoted"', '1', true)`;
        await tx`select ex.fn_post_voucher(${tx.json({
          type: "OPENING", date: "2026-04-01",
          lines: [
            { account_code: "CASH-USD", currency: "USD", fx_amount: "500", rate: "86", dc: "D" },
            { account_code: "OB-EQUITY", currency: "INR", fx_amount: "43000", rate: "1", dc: "C" },
          ],
        } as never)})`;

        const tables = backupTables(true);
        const counts = await countRows(tx, tables);
        await tx`select ex.fn_record_backup(${tx.json({ file_name: "t.zip", include_audit: true, table_count: tables.length, row_count: 1, schema_version: "t" })})`;
        recorded = (await tx`select count(*)::int n from ex.backup_log`)[0].n;
        manifest = await writeBackup(tx, { company: { id: Number(a), code: "A", name: "Backup A" }, by: { id: Number(ua), name: "Admin A" }, includeAudit: true, counts: await countRows(tx, tables) }, (c) => chunks.push(c));

        // a user without backup.manage cannot record a backup
        const [{ plain }] = await tx`select r.id as plain from ex.role r where not exists (select 1 from ex.role_permission rp where rp.role_id = r.id and rp.permission_code = 'backup.manage') limit 1`;
        await tx`savepoint s1`;
        const [{ u2 }] = await tx`insert into ex.app_user (full_name, email, password_hash, user_type) values ('Plain', 'p@test.invalid', 'x', 'USER') returning id as u2`;
        await tx`insert into ex.user_role (user_id, role_id) values (${u2}, ${plain})`;
        await tx`select set_config('app.user_id', ${String(u2)}, true)`;
        recordDenied = await tx`select ex.fn_record_backup(${tx.json({ file_name: "x", table_count: 1, row_count: 1, schema_version: "t" })})`.then(() => "allowed", (e) => String(e.message));
        await tx`rollback to savepoint s1`;
        void counts;
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }

    const zipBytes = Buffer.concat(chunks);
    const files = unzipSync(zipBytes);
    const byName = Object.fromEntries(manifest.tables.map((t) => [t.name, t]));

    expect(recorded).toBe(1);
    expect(recordDenied).toMatch(/backup\.manage/);
    expect(JSON.parse(strFromU8(files["manifest.json"])).total_rows).toBe(manifest.total_rows);
    expect(manifest.tables.map((t) => t.name)).toEqual(backupTables(true));
    for (const t of manifest.tables) {
      for (const f of [t.csv, t.json]) expect(createHash("sha256").update(files[f.path]).digest("hex")).toBe(f.sha256);
      expect(strFromU8(files[t.json.path]).split("\n").filter(Boolean).length).toBe(t.rows);
    }
    expect(byName.company.rows).toBe(1);
    expect(byName.voucher.rows).toBe(1);
    expect(byName.voucher_line.rows).toBe(2);
    expect(byName.party.rows).toBe(1);
    expect(byName.backup_log.rows).toBe(1);
    expect(byName.app_user.omitted).toEqual(["password_hash"]);
    const all = Object.values(files).map((f) => strFromU8(f)).join("\n");
    expect(all).not.toContain("SECRET-B");
    expect(strFromU8(files["json/app_user.ndjson"])).not.toContain("password_hash");
    expect(strFromU8(files["csv/app_user.csv"])).not.toContain("password_hash");
    // formula injection guarded in CSV, exact in JSON
    expect(strFromU8(files["csv/party.csv"])).toContain(`"'=cmd|calc, ""quoted"""`);
    expect(strFromU8(files["json/party.ndjson"])).toContain(`"full_name":"=cmd|calc, \\"quoted\\""`);
    expect(strFromU8(files["checks/trial_balance.csv"])).toContain("CASH-USD");

    const dir = mkdtempSync(join(tmpdir(), "fxb-"));
    const path = join(dir, "b.zip");
    writeFileSync(path, zipBytes);
    expect(execFileSync("node", ["scripts/verify-backup.mjs", path]).toString()).toContain("OK");
    files["csv/party.csv"][5] ^= 1;
    const { zipSync } = await import("fflate");
    writeFileSync(path, zipSync(files));
    expect(() => execFileSync("node", ["scripts/verify-backup.mjs", path], { stdio: "pipe" })).toThrow(/checksum mismatch/);
  });
});
