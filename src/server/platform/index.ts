import "server-only";
import { isUnreachable } from "@/lib/db";
import { withPlatform } from "@/lib/platform-db";
import { burnVerifyTime, hashPassword, temporaryPassword, verifyPassword } from "@/lib/password";
import type { PlatformSession } from "@/lib/platform-session";
import { checkPlatformLoginRate } from "@/lib/ratelimit";
import { requestMeta } from "@/lib/session";

/**
 * Everything a Super Admin can do — which is opening and closing accounts, and nothing else.
 *
 * Every function here ends in one of the ex.fn_platform_* database functions, each of which
 * checks the actor is still an active Super Admin and writes what happened to ex.platform_audit.
 * Nothing in this file can read a voucher, a party or a balance, because the connection it uses
 * has no privilege to.
 */

export type Company = {
  id: string; code: string; name: string; status: "ACTIVE" | "SUSPENDED" | "CLOSED";
  base_currency: string; primary_currency: string; is_set_up: boolean;
  admins: number; users: number; created_at: string; last_login_at: string | null;
};

export type CompanyUser = {
  id: string; full_name: string; email: string; phone: string | null;
  user_type: "ADMIN" | "USER"; status: "ACTIVE" | "INACTIVE" | "LOCKED";
  must_change_password: boolean; profile_done: boolean;
  locked_until: string | null; last_login_at: string | null; created_at: string;
};

export type AuditRow = {
  id: string; at: string; who: string; action: string;
  company_code: string | null; detail: Record<string, string> | null; ip: string | null;
};

// ---------------------------------------------------------------------------- signing in

export type PlatformAuthResult =
  | { ok: true; data: { userId: number; userName: string; email: string; mustChangePassword: boolean } }
  | { ok: false; error: string };

type AuthRow = {
  id: string; full_name: string; email: string; password_hash: string;
  status: string; must_change_password: boolean; locked_until: Date | null;
};

const GENERIC = "That email address or mobile number and password do not match an account.";

export async function authenticatePlatform(input: { login: string; password: string; ip: string }): Promise<PlatformAuthResult> {
  const login = input.login.trim();

  const rate = await checkPlatformLoginRate(input.ip, login);
  if (!rate.ok) return { ok: false, error: `Too many attempts. Try again in ${Math.ceil(rate.retryAfterSec / 60)} minute(s).` };

  // an email address or a mobile number — both are unique across the Super Admins
  let rows: AuthRow[];
  try {
    rows = await withPlatform((tx) => tx<AuthRow[]>`select * from ex.fn_platform_auth(${login})`);
  } catch (e) {
    if (!isUnreachable(e)) throw e;
    console.error("console sign-in: the database could not be reached", e);
    return { ok: false, error: "The console cannot reach its database at the moment. Wait a few seconds and try again." };
  }
  const u = rows[0];
  if (!u) {
    await burnVerifyTime(input.password); // same timing as a wrong password
    return { ok: false, error: GENERIC };
  }
  if (u.locked_until && new Date(u.locked_until).getTime() > Date.now()) {
    await burnVerifyTime(input.password);
    const mins = Math.ceil((new Date(u.locked_until).getTime() - Date.now()) / 60000);
    return { ok: false, error: `This account is locked after too many wrong passwords. Try again in ${mins} minute(s).` };
  }
  if (!(await verifyPassword(u.password_hash, input.password))) {
    const [r] = await withPlatform((tx) => tx<{ locked: boolean }[]>`select ex.fn_platform_login_result(${Number(u.id)}, false) as locked`);
    if (r?.locked) return { ok: false, error: "Too many wrong passwords. The account is locked for 15 minutes." };
    return { ok: false, error: GENERIC };
  }
  if (u.status !== "ACTIVE") return { ok: false, error: "This Super Admin account has been switched off." };

  await withPlatform((tx) => tx`select ex.fn_platform_login_result(${Number(u.id)}, true)`);
  return {
    ok: true,
    data: { userId: Number(u.id), userName: u.full_name, email: u.email, mustChangePassword: u.must_change_password },
  };
}

export async function setOwnPassword(s: PlatformSession, newPassword: string): Promise<void> {
  const hash = await hashPassword(newPassword);
  await withPlatform((tx) => tx`select ex.fn_platform_set_password(${s.userId}, ${hash})`);
}

// ---------------------------------------------------------------------------- reading

export async function listCompanies(_s: PlatformSession, q?: string): Promise<Company[]> {
  return withPlatform((tx) => tx<Company[]>`select * from ex.fn_platform_companies(${q ?? null})`);
}

export async function getCompany(s: PlatformSession, id: number): Promise<{ company: Company; users: CompanyUser[] } | null> {
  const [company] = (await listCompanies(s)).filter((c) => Number(c.id) === id);
  if (!company) return null;
  const users = await withPlatform((tx) => tx<CompanyUser[]>`select * from ex.fn_platform_users(${id})`);
  return { company, users };
}

export async function auditTrail(_s: PlatformSession, companyId?: number, limit = 200): Promise<AuditRow[]> {
  return withPlatform((tx) => tx<AuditRow[]>`select * from ex.fn_platform_audit_log(${companyId ?? null}, ${limit})`);
}

// ---------------------------------------------------------------------------- writing

/** Everything a Super Admin changes goes through here, so the actor and the caller's IP are never forgotten. */
async function act<T>(s: PlatformSession, fn: string, payload: Record<string, unknown>): Promise<T> {
  const { ip } = await requestMeta();
  return withPlatform(async (tx) => {
    const [r] = await tx<{ v: T }[]>`select ex.${tx(fn)}(${tx.json({ ...payload, actor: s.userId, ip } as never)}) as v`;
    return r.v;
  });
}

export type NewCompany = {
  /** optional: the database assigns C001, C002, … when it is not given */
  code?: string; legalName: string; adminName: string; adminEmail: string; adminPhone?: string | null;
};

/** Opens an account: the company, its first Administrator, and a password to hand over once. */
export async function createCompany(s: PlatformSession, v: NewCompany): Promise<{ companyId: string; code: string; adminEmail: string; password: string }> {
  const password = temporaryPassword();
  const out = await act<Record<string, string>>(s, "fn_platform_create_company", {
    code: v.code ?? null, legal_name: v.legalName,
    admin_name: v.adminName, admin_email: v.adminEmail, admin_phone: v.adminPhone ?? null,
    admin_password_hash: await hashPassword(password),
  });
  return { companyId: String(out.company_id), code: String(out.company_code), adminEmail: String(out.admin_email), password };
}

export type NewUser = { companyId: number; fullName: string; email: string; phone?: string | null; userType: "ADMIN" | "USER" };

export async function createUser(s: PlatformSession, v: NewUser): Promise<{ userId: string; fullName: string; email: string; password: string }> {
  const password = temporaryPassword();
  const out = await act<Record<string, string>>(s, "fn_platform_create_user", {
    company_id: v.companyId, full_name: v.fullName, email: v.email,
    phone: v.phone ?? null, user_type: v.userType, password_hash: await hashPassword(password),
  });
  return { userId: String(out.user_id), fullName: String(out.full_name), email: String(out.email), password };
}

export async function setUserStatus(s: PlatformSession, companyId: number, userId: number, status: "ACTIVE" | "INACTIVE"): Promise<{ fullName: string; status: string }> {
  const out = await act<Record<string, string>>(s, "fn_platform_set_user_status", { company_id: companyId, user_id: userId, status });
  return { fullName: String(out.full_name), status: String(out.status) };
}

export async function resetUserPassword(s: PlatformSession, companyId: number, userId: number): Promise<{ fullName: string; email: string; password: string }> {
  const password = temporaryPassword();
  const out = await act<Record<string, string>>(s, "fn_platform_reset_password", {
    company_id: companyId, user_id: userId, password_hash: await hashPassword(password),
  });
  return { fullName: String(out.full_name), email: String(out.email), password };
}

export type DeletedCompany = {
  code: string; legalName: string;
  /** what the company was holding when it went */
  was: { vouchers: number; parties: number; people: number; deposits: number; deals: number };
  /** rows removed, table by table */
  rows: Record<string, number>;
};

/**
 * Erase a company and everything it owns. There is no undo and no recycle bin.
 *
 * The database does the refusing, not this function: it will not touch a company that is
 * still running, it requires the code typed out and a reason, and every delete inside it is
 * scoped by row-level security to the one company — so even a mistake in the SQL could not
 * reach another company's books.
 */
export async function deleteCompany(
  s: PlatformSession, companyId: number, confirmCode: string, reason: string, blockFirst = false,
): Promise<DeletedCompany> {
  const out = await act<{ code: string; legal_name: string; was: DeletedCompany["was"]; rows: Record<string, number> }>(
    s, "fn_platform_delete_company",
    { company_id: companyId, confirm_code: confirmCode, reason, block_first: blockFirst },
  );
  return { code: out.code, legalName: out.legal_name, was: out.was, rows: out.rows ?? {} };
}

export async function setCompanyStatus(s: PlatformSession, companyId: number, status: "ACTIVE" | "SUSPENDED" | "CLOSED", reason: string): Promise<{ code: string; status: string }> {
  const out = await act<Record<string, string>>(s, "fn_platform_set_company_status", { company_id: companyId, status, reason });
  return { code: String(out.code), status: String(out.status) };
}
