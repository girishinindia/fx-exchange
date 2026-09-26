import ExcelJS from "exceljs";
import type { NextRequest } from "next/server";
import { getCompanyInfo } from "@/lib/company";
import { CSV_BOM, csvCell } from "@/lib/csv";
import { hasPermission } from "@/lib/permissions";
import { checkRate } from "@/lib/ratelimit";
import { periodLabel, runReport } from "@/lib/report-access";
import { CA_PACK, type Col, type ReportResult } from "@/lib/reports";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const NUM_FMT: Partial<Record<Col["type"], string>> = { money: "#,##0.00", qty: "#,##0.00##", rate: "0.0000", int: "0", pct: "0.00" };

function toCsv(r: ReportResult): string {
  const lines = [r.columns.map((c) => csvCell(c.label)).join(",")];
  for (const row of r.rows) lines.push(r.columns.map((c) => csvCell(row[c.key])).join(","));
  if (r.totals) lines.push(r.columns.map((c) => csvCell(r.totals![c.key])).join(","));
  return CSV_BOM + lines.join("\r\n"); // BOM so Excel opens ₹ and names correctly
}

function newWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "FX Desk";
  wb.created = new Date();
  return wb;
}

/** One report onto one sheet — the same layout whether it is downloaded alone or inside the pack. */
function addSheet(wb: ExcelJS.Workbook, r: ReportResult, title: string, subtitle: string, company: string): void {
  const ws = wb.addWorksheet(title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "), { views: [{ state: "frozen", ySplit: 4 }] });
  ws.addRow([company]).font = { bold: true, size: 13 };
  ws.addRow([`${title} · ${subtitle}`]).font = { color: { argb: "FF475569" } };
  ws.addRow([]);
  const head = ws.addRow(r.columns.map((c) => c.label));
  head.font = { bold: true };
  head.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0F2FE" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FF7DD3FC" } } };
  });
  const add = (row: Record<string, unknown>, bold = false) => {
    const xr = ws.addRow(r.columns.map((c) => {
      const v = row[c.key];
      if (v === null || v === undefined || v === "") return null;
      return c.type === "text" || c.type === "date" || c.type === "link" ? String(v) : Number(v); // numbers stay numbers in Excel
    }));
    if (bold) xr.font = { bold: true };
  };
  r.rows.forEach((row) => add(row));
  if (r.totals) add(r.totals, true);
  r.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (NUM_FMT[c.type]) col.numFmt = NUM_FMT[c.type]!;
    col.width = Math.min(40, Math.max(c.label.length + 2, c.type === "text" ? 16 : 14));
  });
  if (r.note) {
    ws.addRow([]);
    ws.addRow([r.note]).font = { italic: true, color: { argb: "FF64748B" } };
  }
}

async function toXlsx(r: ReportResult, title: string, subtitle: string, company: string): Promise<ArrayBuffer> {
  const wb = newWorkbook();
  addSheet(wb, r, title, subtitle, company);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** The whole CA pack as one workbook, a sheet per statement, in reading order. */
async function packXlsx(
  runs: { title: string; subtitle: string; result: ReportResult }[], company: string,
): Promise<ArrayBuffer> {
  const wb = newWorkbook();
  for (const r of runs) addSheet(wb, r.result, r.title, r.subtitle, company);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** GET /api/export/<report>?format=csv|xlsx&from=&to=&group=&cur=&q= — needs export.data. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/export/[report]">) {
  const s = await getSession();
  if (!s || s.mustChangePassword) return new Response("Sign in first", { status: 401 });
  if (!(await hasPermission(s, "export.data"))) return new Response("Permission denied: export.data", { status: 403 });
  const rl = await checkRate("export", s.companyId, s.userId);
  if (!rl.ok) return new Response(`Too many downloads. Try again in ${rl.retryAfterSec} s.`, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } });
  const { report } = await ctx.params;
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const company0 = (await getCompanyInfo(s)).name;

  if (report === "ca-pack") {
    const runs: { title: string; subtitle: string; result: ReportResult }[] = [];
    for (const key of CA_PACK) {
      const one = await runReport(s, key, sp);
      if (!one || !one.access.ok || !one.result) continue;   // a statement the user may not see is left out
      runs.push({ title: one.def.title, subtitle: periodLabel(one.def, one.params!), result: one.result });
    }
    if (runs.length === 0) return new Response("Permission denied", { status: 403 });
    const buf = await packXlsx(runs, company0);
    const name = `ca-pack_${sp.from ?? ""}_${sp.to ?? ""}`.replace(/_+$/, "");
    return new Response(buf, {
      headers: { ...{ "cache-control": "no-store", "x-content-type-options": "nosniff" },
                 "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                 "content-disposition": `attachment; filename="${name}.xlsx"` },
    });
  }

  const run = await runReport(s, report, sp);
  if (!run) return new Response("Unknown report", { status: 404 });
  if (!run.access.ok) return new Response(`Permission denied: ${run.access.reason}`, { status: 403 });
  const { def, params, result } = run;
  const company = company0;
  const stamp = `${params!.from}_${params!.to}`;
  const base = `${report}_${def.params.includes("period") ? stamp : params!.to}`;
  const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

  if (sp.format === "xlsx") {
    const buf = await toXlsx(result!, def.title, periodLabel(def, params!), company);
    return new Response(buf, {
      headers: { ...headers, "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${base}.xlsx"` },
    });
  }
  return new Response(toCsv(result!), {
    headers: { ...headers, "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${base}.csv"` },
  });
}
