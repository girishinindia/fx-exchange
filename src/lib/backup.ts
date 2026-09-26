import "server-only";
import { createHash } from "node:crypto";
import { Zip, ZipDeflate } from "fflate";
import { CSV_BOM, csvCell } from "@/lib/csv";
import type { Tx } from "@/lib/db";

/**
 * Company backup (service 39): every table of the company as CSV (for people / Excel) and
 * NDJSON (exact values, for machines), plus balance check files and a manifest with SHA-256
 * of every file. Built inside ONE read-only REPEATABLE READ transaction, so all files are
 * from the same instant. RLS limits every query to the company in context.
 */
export const SCHEMA_VERSION = "0012_year_end";
export const BACKUP_FORMAT = "fx-desk-backup/1";

/** Parents before children — the order a restore would load them in. */
export const BACKUP_TABLES = [
  "company", "company_currency", "role", "role_permission", "app_user", "user_role",
  "party", "account", "fy_period", "voucher_series",
  "voucher", "voucher_line", "deposit", "deal", "deal_funding",
  "login_history", "backup_log",
] as const;
export const AUDIT_TABLE = "audit_log";

/** Columns never written to a backup file. */
export const OMITTED: Record<string, string[]> = { app_user: ["password_hash"] };

/** Derived balances at backup time — used to check a restore gives the same numbers. */
const CHECKS: { name: string; sql: (tx: Tx) => ReturnType<Tx> }[] = [
  { name: "trial_balance", sql: (tx) => tx`select * from ex.v_trial_balance order by 1, 2` },
  { name: "account_balance", sql: (tx) => tx`select * from ex.v_account_balance order by 1, 2` },
  { name: "party_balance", sql: (tx) => tx`select * from ex.v_party_balance order by 1, 2, 5` },
  { name: "currency_position", sql: (tx) => tx`select * from ex.v_currency_position order by 1, 2` },
  { name: "depositor_summary", sql: (tx) => tx`select * from ex.v_depositor_summary order by 1, 2` },
  { name: "client_summary", sql: (tx) => tx`select * from ex.v_client_summary order by 1, 2` },
  { name: "deal_status", sql: (tx) => tx`select * from ex.v_deal_status order by 1, 2` },
  { name: "client_position", sql: (tx) => tx`select * from ex.v_client_position order by 1, 2` },
];

export type FileEntry = { path: string; bytes: number; sha256: string };
export type TableEntry = { name: string; rows: number; columns: string[]; omitted: string[]; csv: FileEntry; json: FileEntry };
export type Manifest = {
  format: string;
  schema_version: string;
  company: { id: number; code: string; name: string };
  generated_at: string;
  generated_by: { id: number; name: string };
  include_audit: boolean;
  consistency: string;
  tables: TableEntry[];
  checks: FileEntry[];
  total_rows: number;
};

export function backupTables(includeAudit: boolean): string[] {
  return includeAudit ? [...BACKUP_TABLES, AUDIT_TABLE] : [...BACKUP_TABLES];
}

export async function countRows(tx: Tx, tables: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of tables) out[t] = (await tx<{ n: number }[]>`select count(*)::int as n from ex.${tx(t)}`)[0].n;
  return out;
}

async function columnsOf(tx: Tx, table: string): Promise<{ keep: string[]; omitted: string[] }> {
  const rows = await tx<{ c: string }[]>`
    select column_name as c from information_schema.columns
     where table_schema = 'ex' and table_name = ${table} order by ordinal_position`;
  const omit = OMITTED[table] ?? [];
  return { keep: rows.map((r) => r.c).filter((c) => !omit.includes(c)), omitted: omit.filter((c) => rows.some((r) => r.c === c)) };
}

const enc = new TextEncoder();

/** One file inside the zip, streamed in pieces, with its hash and size. */
function openFile(zip: Zip, path: string) {
  const f = new ZipDeflate(path, { level: 6 });
  zip.add(f);
  const hash = createHash("sha256");
  let bytes = 0;
  return {
    write(text: string) {
      if (!text) return;
      const u = enc.encode(text);
      hash.update(u);
      bytes += u.length;
      f.push(u, false);
    },
    close(): FileEntry {
      f.push(new Uint8Array(0), true);
      return { path, bytes, sha256: hash.digest("hex") };
    },
  };
}

const jsonLine = (row: Record<string, unknown>) => JSON.stringify(row) + "\n";

/**
 * Writes the whole backup zip, chunk by chunk, to `emit`.
 * Must be called inside withTenant(..., { snapshot: true }).
 */
export async function writeBackup(
  tx: Tx,
  meta: { company: Manifest["company"]; by: Manifest["generated_by"]; includeAudit: boolean; counts: Record<string, number> },
  emit: (chunk: Uint8Array) => void,
): Promise<Manifest> {
  let done!: () => void;
  let failed!: (e: Error) => void;
  const finished = new Promise<void>((res, rej) => { done = res; failed = rej; });
  const zip = new Zip((err, chunk, final) => {
    if (err) return failed(err);
    emit(chunk);
    if (final) done();
  });

  const tables: TableEntry[] = [];
  for (const name of backupTables(meta.includeAudit)) {
    const { keep, omitted } = await columnsOf(tx, name);
    const query = () => tx`select ${tx(keep)} from ex.${tx(name)} order by 1`;

    const csv = openFile(zip, `csv/${name}.csv`);
    csv.write(CSV_BOM + keep.join(",") + "\r\n");
    let rows = 0;
    await query().cursor(2000, (batch) => {
      rows += batch.length;
      csv.write(batch.map((r) => keep.map((c) => csvCell(r[c])).join(",")).join("\r\n") + "\r\n");
    });
    const csvEntry = csv.close();

    const json = openFile(zip, `json/${name}.ndjson`);
    let jrows = 0;
    await query().cursor(2000, (batch) => {
      jrows += batch.length;
      json.write(batch.map((r) => jsonLine(r)).join(""));
    });
    const jsonEntry = json.close();

    if (rows !== jrows || rows !== meta.counts[name]) throw new Error(`Backup changed while reading ${name}`);
    tables.push({ name, rows, columns: keep, omitted, csv: csvEntry, json: jsonEntry });
  }

  const checks: FileEntry[] = [];
  for (const c of CHECKS) {
    const rows = (await c.sql(tx)) as unknown as Record<string, unknown>[];
    const cols = rows.length ? Object.keys(rows[0]) : [];
    const f = openFile(zip, `checks/${c.name}.csv`);
    f.write(CSV_BOM + cols.join(",") + "\r\n" + rows.map((r) => cols.map((k) => csvCell(r[k])).join(",")).join("\r\n") + (rows.length ? "\r\n" : ""));
    checks.push(f.close());
  }

  const manifest: Manifest = {
    format: BACKUP_FORMAT,
    schema_version: SCHEMA_VERSION,
    company: meta.company,
    generated_at: new Date().toISOString(),
    generated_by: meta.by,
    include_audit: meta.includeAudit,
    consistency: "single read-only REPEATABLE READ snapshot",
    tables,
    checks,
    total_rows: tables.reduce((a, t) => a + t.rows, 0),
  };
  const readme = openFile(zip, "README.txt");
  readme.write(readmeText(manifest));
  readme.close();
  const m = openFile(zip, "manifest.json");
  m.write(JSON.stringify(manifest, null, 2));
  m.close();
  zip.end();
  await finished;
  return manifest;
}

function readmeText(m: Manifest): string {
  return [
    `FX Desk — company backup`,
    `Company: ${m.company.name} (${m.company.code})`,
    `Taken:   ${m.generated_at} by ${m.generated_by.name}`,
    `Schema:  ${m.schema_version}`,
    ``,
    `csv/     one file per table — open in Excel (UTF-8). Text starting with = + - @ is prefixed with ' for safety.`,
    `json/    the same rows as NDJSON (one JSON object per line) — exact values, use these for a restore.`,
    `checks/  trial balance, account, party and currency balances at backup time — a restore must reproduce these numbers.`,
    `manifest.json  row count and SHA-256 of every file. Verify with:  npm run backup:verify -- <file.zip>`,
    ``,
    `Password hashes are NOT included. After a restore every user sets a new password.`,
    `Keep this file private: it contains customer names, ID numbers and all transactions.`,
    ``,
  ].join("\r\n");
}
