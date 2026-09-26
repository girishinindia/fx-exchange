import "server-only";
import { withTenant } from "@/lib/db";
import { getCompanyInfo } from "@/lib/company";
import { formatDate, fyStartISO, todayISO } from "@/lib/format";
import { getPermissions, type Permission } from "@/lib/permissions";
import { REPORTS, reportParams, type ReportDef, type ReportParams, type ReportResult } from "@/lib/reports";
import { tenantOf, type Session } from "@/lib/session";

export type Access = { ok: true } | { ok: false; reason: Permission };

/** Every report needs report.view; a few may need a stronger permission of their own. */
export async function reportAccess(s: Session, def: ReportDef): Promise<Access> {
  const perms = await getPermissions(s);
  const need: Permission = def.permission ?? "report.view";
  return perms.has(need) ? { ok: true } : { ok: false, reason: need };
}

export async function runReport(s: Session, key: string, sp: Record<string, string | string[] | undefined>) {
  const def = REPORTS[key];
  if (!def) return null;
  const access = await reportAccess(s, def);
  if (!access.ok) return { def, access, params: null, result: null } as const;
  const company = await getCompanyInfo(s);
  const params: ReportParams = reportParams(sp, todayISO(), fyStartISO(company.fiscalYearStartMonth));
  const result: ReportResult = await withTenant(await tenantOf(s), (tx) => def.run(tx, params, { ownUserId: null }));
  return { def, access, params, result } as const;
}

export function periodLabel(def: ReportDef, p: ReportParams): string {
  const parts: string[] = [];
  const asAt = def.title.includes("balance") || def.title.includes("position");
  if (def.params.includes("period")) parts.push(asAt ? `as at ${formatDate(p.to)}` : `${formatDate(p.from)} – ${formatDate(p.to)}`);
  if (p.q) parts.push(`“${p.q}”`);
  return parts.join(" · ");
}

export function queryString(p: ReportParams, extra: Record<string, string> = {}): string {
  const o: Record<string, string> = {
    from: p.from, to: p.to,
    ...(p.q ? { q: p.q } : {}),
    ...(p.cur ? { cur: p.cur } : {}),
    ...(p.party ? { party: String(p.party) } : {}),
    ...extra,
  };
  return new URLSearchParams(o).toString();
}
