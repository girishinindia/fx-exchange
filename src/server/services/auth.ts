import "server-only";
import { isUnreachable, withSystem, withTenant, type TenantContext } from "@/lib/db";
import { burnVerifyTime, verifyPassword } from "@/lib/password";
import { clearPermissionCache } from "@/lib/permissions";
import { checkLoginRate } from "@/lib/ratelimit";
import type { NewSession } from "@/lib/session";

/**
 * One authentication path for the portal and the mobile API: same rate limit, same
 * account lock, same login history. Only what happens afterwards differs — the portal
 * sets a cookie, the API returns a bearer token.
 */

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const GENERIC = "That email address or mobile number and password do not match an account.";

type AuthRow = {
  company_id: string; company_code: string; company_status: string; user_id: string; user_type: "ADMIN" | "USER";
  full_name: string; password_hash: string; user_status: string; locked_until: Date | null; must_change_password: boolean;
};

export type AuthResult = { ok: true; data: NewSession } | { ok: false; error: string; status: 401 | 423 | 429 | 503 };

/**
 * A database that cannot be reached is not a wrong password, and saying so saves somebody
 * retyping a password that was right all along. It is also the shape of every network problem
 * between here and the database — a blocked port, a paused project, a dropped line.
 */
const UNREACHABLE =
  "The desk cannot reach its database at the moment, so it cannot check your password. " +
  "Wait a few seconds and try again. If it keeps happening, tell Genius ITens.";

export async function authenticate(input: {
  /** An email address or a mobile number. There is no company code: a person belongs to one company. */
  login: string; password: string;
  ip: string; userAgent: string | null; context: "web" | "api";
}): Promise<AuthResult> {
  const login = input.login.trim();

  const rate = await checkLoginRate(input.ip, login);
  if (!rate.ok) return { ok: false, status: 429, error: `Too many attempts. Try again in ${Math.ceil(rate.retryAfterSec / 60)} minute(s).` };

  // The lookup matches the email address or the mobile number, and returns the one company
  // that person works for. Both columns are globally unique, so this is never ambiguous.
  let rows: AuthRow[];
  try {
    rows = await withSystem((tx) => tx<AuthRow[]>`select * from ex.fn_auth_lookup(${login})`);
  } catch (e) {
    if (!isUnreachable(e)) throw e;
    console.error("sign-in: the database could not be reached", e);
    return { ok: false, status: 503, error: UNREACHABLE };
  }
  const u = rows[0];
  if (!u) {
    await burnVerifyTime(input.password); // same timing as a wrong password
    return { ok: false, status: 401, error: GENERIC };
  }

  const ctx: TenantContext = { companyId: Number(u.company_id), userId: Number(u.user_id), clientIp: input.ip, context: input.context };
  const history = (success: boolean, reason: string | null) =>
    withTenant(ctx, (tx) => tx`
      insert into ex.login_history (user_id, success, failure_reason, ip_address, user_agent, app_context)
      values (${ctx.userId}, ${success}, ${reason}, ${input.ip === "unknown" ? null : input.ip}::inet,
              ${input.userAgent?.slice(0, 300) ?? null}, ${input.context})`);

  if (u.locked_until && new Date(u.locked_until).getTime() > Date.now()) {
    await burnVerifyTime(input.password);
    await history(false, "locked");
    const mins = Math.ceil((new Date(u.locked_until).getTime() - Date.now()) / 60000);
    return { ok: false, status: 423, error: `This account is locked after too many wrong passwords. Try again in ${mins} minute(s).` };
  }

  if (!(await verifyPassword(u.password_hash, input.password))) {
    const [r] = await withTenant(ctx, (tx) => tx<{ failed_login_count: number; locked: boolean }[]>`
      update ex.app_user
         set failed_login_count = case when failed_login_count + 1 >= ${MAX_FAILED} then 0 else failed_login_count + 1 end,
             locked_until       = case when failed_login_count + 1 >= ${MAX_FAILED} then now() + make_interval(mins => ${LOCK_MINUTES}) else locked_until end
       where id = ${ctx.userId}
      returning failed_login_count, (locked_until > now()) as locked`);
    await history(false, "wrong_password");
    if (r?.locked) return { ok: false, status: 423, error: `Too many wrong passwords. The account is locked for ${LOCK_MINUTES} minutes.` };
    return { ok: false, status: 401, error: GENERIC };
  }

  if (u.company_status !== "ACTIVE") {
    await history(false, "company_inactive");
    return { ok: false, status: 401, error: "This company account is not active. Please contact Genius ITens." };
  }
  if (u.user_status !== "ACTIVE") {
    await history(false, "user_inactive");
    return { ok: false, status: 401, error: "Your account is disabled. Please contact your administrator." };
  }

  await withTenant(ctx, (tx) => tx`
    update ex.app_user set failed_login_count = 0, locked_until = null, last_login_at = now() where id = ${ctx.userId}`);
  await history(true, null);
  await clearPermissionCache(ctx.companyId, [ctx.userId]);

  const [r] = await withTenant(ctx, (tx) =>
    tx<{ code: string; name: string; full_name: string; email: string; user_type: "ADMIN" | "USER";
        counter_name: string | null; must_change_password: boolean;
        profile_done: boolean; company_set_up: boolean }[]>`
      select c.code, coalesce(c.display_name, c.legal_name) as name, u.full_name, u.email, u.user_type,
             u.counter_name, u.must_change_password,
             u.profile_completed_at is not null as profile_done,
             c.setup_completed_at  is not null as company_set_up
        from ex.app_user u join ex.company c on c.id = u.company_id
       where u.id = ${ctx.userId}`);
  if (!r) return { ok: false, status: 401, error: GENERIC };

  return {
    ok: true,
    data: {
      userId: ctx.userId,
      companyId: ctx.companyId,
      companyCode: r.code,
      companyName: r.name,
      userName: r.full_name,
      email: r.email,
      userType: r.user_type,
      counterName: r.counter_name,
      mustChangePassword: r.must_change_password,
      profileCompleted: r.profile_done,
      companySetUp: r.company_set_up,
    },
  };
}
