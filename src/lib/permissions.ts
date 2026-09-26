import "server-only";
import { redirect } from "next/navigation";
import { withTenant } from "@/lib/db";
import { keys, redis, TTL } from "@/lib/redis";
import { requireSession, tenantOf, type Session } from "@/lib/session";

/**
 * The 16 permission codes of ex.permission.
 *
 * `user.manage` and `role.manage` used to be here. They are gone — not merely ungranted but
 * deleted from the catalogue in 0013 — because adding and removing people is the Super Admin's
 * job now. A code that does not exist cannot be granted back by anybody, which is the point.
 */
export const PERMISSIONS = [
  "company.manage", "user.view", "currency.manage",
  "party.view", "party.manage",
  "account.manage", "fy.lock",
  "voucher.view", "voucher.create", "deal.manage", "voucher.reverse",
  "report.view", "export.data",
  "audit.view", "backup.manage", "api.access",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Permissions of the session user — cached in Redis for 5 minutes, cleared when roles change. */
export async function getPermissions(s: Session): Promise<Set<Permission>> {
  if (s.preview) return new Set(PERMISSIONS);
  const key = keys.permissions(s.companyId, s.userId);
  const cached = await redis().get<Permission[]>(key);
  if (cached) return new Set(cached);

  const rows = await withTenant(await tenantOf(s), (tx) =>
    tx<{ code: Permission }[]>`
      select distinct rp.permission_code as code
        from ex.user_role ur
        join ex.role_permission rp on rp.company_id = ur.company_id and rp.role_id = ur.role_id
        join ex.app_user u on u.company_id = ur.company_id and u.id = ur.user_id
       where ur.user_id = ${s.userId} and u.status = 'ACTIVE'`,
  );
  const list = rows.map((r) => r.code);
  await redis().set(key, list, { ex: TTL.permissions });
  return new Set(list);
}

export async function hasPermission(s: Session, p: Permission): Promise<boolean> {
  return (await getPermissions(s)).has(p);
}

/** Page guard: redirect to the dashboard when the permission is missing. */
export async function requirePermission(p: Permission): Promise<Session> {
  const s = await requireSession();
  if (!(await hasPermission(s, p))) redirect("/dashboard?denied=" + encodeURIComponent(p));
  return s;
}

/**
 * Guard for actions and services: throws (never redirects) so the caller shows an error.
 * Pass the session when there is one — an API request carries a bearer token, not a cookie,
 * and resolving the session from cookies there would redirect to the login page instead.
 */
export async function assertPermission(p: Permission, session?: Session): Promise<Session> {
  const s = session ?? (await requireSession());
  if (!(await hasPermission(s, p))) throw new PermissionError(p);
  return s;
}

export class PermissionError extends Error {
  constructor(public permission: string) {
    super(`You do not have permission: ${permission}`);
  }
}

/** Drop cached permissions for these users (after role or user changes). */
export async function clearPermissionCache(companyId: number, userIds: number[]): Promise<void> {
  if (userIds.length) await redis().del(...userIds.map((u) => keys.permissions(companyId, u)));
}
