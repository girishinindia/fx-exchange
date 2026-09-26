#!/usr/bin/env node
// Verifies an FX Desk company backup ZIP: every file listed in manifest.json exists,
// its SHA-256 and size match, and the row count of each NDJSON file matches the manifest.
//   npm run backup:verify -- fx-backup_GI_2026-09-22_1830.zip
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run backup:verify -- <backup.zip>");
  process.exit(2);
}
const files = unzipSync(readFileSync(file));
const problems = [];
const m = JSON.parse(strFromU8(files["manifest.json"] ?? new Uint8Array()) || "null");
if (!m || m.format !== "fx-desk-backup/1") {
  console.error("Not an FX Desk backup (manifest.json missing or wrong format).");
  process.exit(1);
}
const check = (e) => {
  const data = files[e.path];
  if (!data) return problems.push(`${e.path}: missing`);
  if (data.length !== e.bytes) problems.push(`${e.path}: size ${data.length} ≠ ${e.bytes}`);
  const h = createHash("sha256").update(data).digest("hex");
  if (h !== e.sha256) problems.push(`${e.path}: checksum mismatch`);
  return data;
};
let rows = 0;
for (const t of m.tables) {
  check(t.csv);
  const json = check(t.json);
  if (json) {
    const n = strFromU8(json).split("\n").filter(Boolean).length;
    if (n !== t.rows) problems.push(`${t.name}: ${n} rows in JSON ≠ ${t.rows} in manifest`);
    rows += n;
  }
}
for (const c of m.checks) check(c);

console.log(`${m.company.name} (${m.company.code}) · taken ${m.generated_at} by ${m.generated_by.name} · schema ${m.schema_version}`);
console.log(`${m.tables.length} tables · ${rows.toLocaleString("en-IN")} rows · audit log ${m.include_audit ? "included" : "not included"}`);
if (problems.length) {
  console.error(`\nFAILED — ${problems.length} problem(s):\n  ` + problems.join("\n  "));
  process.exit(1);
}
console.log("OK — all files present and checksums match.");
