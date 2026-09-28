import "server-only";
import { z } from "zod";
import { RuleError, optText } from "@/lib/action";
import { backupTables, countRows, SCHEMA_VERSION, writeBackup } from "@/lib/backup";
import { withTenant } from "@/lib/db";
import { assertPermission } from "@/lib/permissions";
import { tenantOf, type Session } from "@/lib/session";

/**
 * Administration, as one set of services for the portal pages, the server actions and
 * /api/v1 alike — so the phone and the browser can never disagree about what an
 * Administrator may see or change.
 *
 * What is deliberately NOT here: creating, blocking or re-roling people. That stays with
 * Genius ITens on the platform console, so access to a company's books can only ever be
 * widened by a third party.
 */

// ------------------------------------------------------------------ people

export type UserRow = {
  id: string; full_name: string; email: string; phone: string | null;
  user_type: "ADMIN" | "USER"; status: "ACTIVE" | "INACTIVE" | "LOCKED";
  role_name: string | null; last_login_at: Date | null; locked: boolean;
  must_change_password: boolean; profile_done: boolean;
};

export async function listUsers(s: Session): Promise<UserRow[]> {
  await assertPermission("user.view", s);
  return withTenant(await tenantOf(s), (tx) => tx<UserRow[]>`
    select u.id, u.full_name, u.email, u.phone, u.user_type, u.status,
           r.name as role_name, u.last_login_at,
           coalesce(u.locked_until > now(), false) as locked, u.must_change_password,
           u.profile_completed_at is not null as profile_done
      from ex.app_user u
      left join lateral (select ur.role_id from ex.user_role ur where ur.user_id = u.id order by ur.id limit 1) x on true
      left join ex.role r on r.id = x.role_id
     order by (u.user_type = 'ADMIN') desc, u.full_name`);
}

// ------------------------------------------------------------------ roles

export type RoleRow = { id: string; code: string; name: string; description: string | null; users: number; perms: string[] };
export type PermRow = { code: string; module: string; description: string };

export async function listRoles(s: Session): Promise<{ roles: RoleRow[]; permissions: PermRow[] }> {
  await assertPermission("user.view", s);
  return withTenant(await tenantOf(s), async (tx) => {
    const roles = await tx<RoleRow[]>`
      select r.id, r.code, r.name, r.description,
             (select count(*)::int from ex.user_role ur where ur.role_id = r.id) as users,
             coalesce((select array_agg(rp.permission_code) from ex.role_permission rp where rp.role_id = r.id), '{}') as perms
        from ex.role r order by (r.code = 'ADMIN') desc, r.name`;
    const permissions = await tx<PermRow[]>`select code, module, description from ex.permission order by module, code`;
    return { roles, permissions };
  });
}

// ------------------------------------------------------------------ currencies

export type CurrencyRow = {
  id: string; currency_code: string; name: string; symbol: string | null; decimal_places: number;
  is_base: boolean; is_primary: boolean; is_active: boolean; display_order: number; in_use: boolean;
};

export async function listCurrencies(s: Session): Promise<{ currencies: CurrencyRow[]; available: { code: string; name: string }[] }> {
  await assertPermission("currency.manage", s);
  return withTenant(await tenantOf(s), async (tx) => {
    const currencies = await tx<CurrencyRow[]>`
      select cc.id, cc.currency_code, m.name, m.symbol, m.decimal_places, cc.is_base,
             (cc.currency_code = co.primary_currency_code) as is_primary, cc.is_active, cc.display_order,
             exists (select 1 from ex.voucher_line l where trim(l.currency_code) = cc.currency_code) as in_use
        from ex.company_currency cc
        join ex.currency_master m on m.code = cc.currency_code
        join ex.company co on co.id = ex.current_company_id()
       order by cc.is_base desc, cc.display_order, cc.currency_code`;
    const available = await tx<{ code: string; name: string }[]>`
      select code, name from ex.currency_master m
       where is_active and not exists (select 1 from ex.company_currency cc where cc.currency_code = m.code and cc.is_active)
       order by code`;
    return { currencies, available };
  });
}

export const EnableCurrency = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Choose a currency"),
  order: z.coerce.number().int().min(0).max(999).default(10),
});

export async function enableCurrency(s: Session, input: z.infer<typeof EnableCurrency>): Promise<{ code: string }> {
  await assertPermission("currency.manage", s);
  const d = EnableCurrency.parse(input);
  await withTenant(await tenantOf(s), async (tx) => {
    const [m] = await tx<{ code: string }[]>`select code from ex.currency_master where code = ${d.code} and is_active`;
    if (!m) throw new RuleError("Unknown currency.");
    await tx`
      insert into ex.company_currency (currency_code, display_order, is_active)
      values (${d.code}, ${d.order}, true)
      on conflict (company_id, currency_code) do update set is_active = true, display_order = excluded.display_order`;
  });
  return { code: d.code };
}

export const UpdateCurrency = z.object({
  id: z.coerce.number().int().positive(),
  order: z.coerce.number().int().min(0).max(999),
  active: z.boolean(),
});

export async function updateCurrency(s: Session, input: z.infer<typeof UpdateCurrency>): Promise<{ code: string }> {
  await assertPermission("currency.manage", s);
  const d = UpdateCurrency.parse(input);
  return withTenant(await tenantOf(s), async (tx) => {
    // The two currencies the company cannot trade without: the one the books are kept in and
    // the one depositors bring in. Both are fixed at setup, so neither may be switched off.
    const [c] = await tx<{ currency_code: string; is_base: boolean; is_primary: boolean }[]>`
      select cc.currency_code, cc.is_base, (cc.currency_code = co.primary_currency_code) as is_primary
        from ex.company_currency cc
        join ex.company co on co.id = ex.current_company_id()
       where cc.id = ${d.id}`;
    if (!c) throw new RuleError("Currency not found.");
    if (c.is_base && !d.active) throw new RuleError("The books are kept in this currency — it cannot be switched off.");
    if (c.is_primary && !d.active) throw new RuleError("Every deposit comes in in this currency — it cannot be switched off.");
    await tx`update ex.company_currency set display_order = ${d.order}, is_active = ${d.active} where id = ${d.id}`;
    return { code: c.currency_code };
  });
}

// ------------------------------------------------------------------ company profile

/** A JSON body may send null or leave a key out; a form sends "" — all mean "blank". */
const blank = (max: number) => z.preprocess((v) => (v === null || v === undefined ? "" : v), optText(max));

export const CompanyProfile = z.object({
  legalName: z.string().trim().min(2, "Enter the legal name").max(200),
  displayName: blank(120),
  gstin: blank(20).refine((v) => v === null || /^[0-9A-Z]{15}$/.test(v.toUpperCase()), "GSTIN must be 15 characters"),
  pan: blank(10).refine((v) => v === null || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v.toUpperCase()), "PAN format: AAAAA9999A"),
  licenseNo: blank(60),
  phone: blank(20),
  email: blank(200).refine((v) => v === null || z.string().email().safeParse(v).success, "Enter a valid email"),
  address: blank(300),
  city: blank(80),
  state: blank(80),
  pincode: blank(10).refine((v) => v === null || /^\d{6}$/.test(v), "PIN code must be 6 digits"),
});

export type CompanyRow = {
  id: string; code: string; legal_name: string; display_name: string | null; gstin: string | null; pan: string | null;
  license_no: string | null; phone: string | null; email: string | null; address: string | null; city: string | null;
  state: string | null; country: string | null; pincode: string | null; base_currency_code: string; primary_currency_code: string;
  fiscal_year_start_month: number; timezone: string; books_start_date: string | null; setup_completed_at: Date | null; vouchers: number;
};

export async function getCompany(s: Session): Promise<CompanyRow> {
  await assertPermission("company.manage", s);
  const [c] = await withTenant(await tenantOf(s), (tx) => tx<CompanyRow[]>`
    select id, code, legal_name, display_name, gstin, pan, license_no, phone, email, address, city, state, country, pincode,
           base_currency_code, primary_currency_code, fiscal_year_start_month, timezone,
           to_char(books_start_date, 'YYYY-MM-DD') as books_start_date, setup_completed_at,
           (select count(*)::int from ex.voucher) as vouchers
      from ex.company where id = ${s.companyId}`);
  return c;
}

export async function saveCompanyProfile(s: Session, input: z.infer<typeof CompanyProfile>): Promise<void> {
  await assertPermission("company.manage", s);
  const d = CompanyProfile.parse(input);
  await withTenant(await tenantOf(s), (tx) => tx`
    update ex.company set legal_name = ${d.legalName}, display_name = ${d.displayName},
           gstin = ${d.gstin?.toUpperCase() ?? null}, pan = ${d.pan?.toUpperCase() ?? null}, license_no = ${d.licenseNo},
           phone = ${d.phone}, email = ${d.email}, address = ${d.address}, city = ${d.city}, state = ${d.state}, pincode = ${d.pincode}
     where id = ${s.companyId}`);
}

// ------------------------------------------------------------------ audit log

export type AuditRow = {
  id: string; changed_at: Date; operation: string; table_name: string; record_id: string | null;
  changed_fields: Record<string, { old: unknown; new: unknown }> | null;
  new_data: Record<string, unknown> | null; old_data: Record<string, unknown> | null;
  user_name: string | null; client_ip: string | null; app_context: string | null;
};

export type AuditFilter = { table?: string | null; op?: string | null; user?: number | null; record?: number | null; from?: string | null; to?: string | null; limit: number; offset: number };

export async function listAudit(s: Session, f: AuditFilter): Promise<{ rows: AuditRow[]; hasMore: boolean; tables: string[]; users: { id: string; full_name: string }[] }> {
  await assertPermission("audit.view", s);
  const op = f.op && ["INSERT", "UPDATE", "DELETE"].includes(f.op) ? f.op : null;
  const from = f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from) ? f.from : null;
  const to = f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to) ? f.to : null;
  const limit = Math.min(Math.max(f.limit, 1), 200);
  return withTenant(await tenantOf(s), async (tx) => {
    const tables = (await tx<{ table_name: string }[]>`select distinct table_name from ex.audit_log order by table_name`).map((t) => t.table_name);
    const table = f.table && tables.includes(f.table) ? f.table : null;
    const rows = await tx<AuditRow[]>`
      select a.id, a.changed_at, a.operation, a.table_name, a.record_id, a.changed_fields, a.new_data, a.old_data,
             u.full_name as user_name, a.client_ip, a.app_context
        from ex.audit_log a
        left join ex.app_user u on u.id = a.changed_by
       where (${table}::text is null or a.table_name = ${table})
         and (${op}::text is null or a.operation = ${op})
         and (${f.user ?? null}::bigint is null or a.changed_by = ${f.user ?? null})
         and (${f.record ?? null}::bigint is null or a.record_id = ${f.record ?? null})
         and (${from}::date is null or a.changed_at >= (${from}::date)::timestamp at time zone 'Asia/Kolkata')
         and (${to}::date is null or a.changed_at < ((${to}::date) + 1)::timestamp at time zone 'Asia/Kolkata')
       order by a.id desc
       limit ${limit + 1} offset ${f.offset}`;
    const users = await tx<{ id: string; full_name: string }[]>`select id, full_name from ex.app_user order by full_name`;
    return { rows: rows.slice(0, limit), hasMore: rows.length > limit, tables, users };
  });
}

// ------------------------------------------------------------------ backup

export type BackupRow = { id: string; created_at: Date; file_name: string; include_audit: boolean; table_count: number; row_count: string; by_name: string | null };

export async function listBackups(s: Session): Promise<{ backups: BackupRow[]; daysSinceLast: number | null }> {
  await assertPermission("backup.manage", s);
  return withTenant(await tenantOf(s), async (tx) => {
    const backups = await tx<BackupRow[]>`
      select b.id, b.created_at, b.file_name, b.include_audit, b.table_count, b.row_count::text, u.full_name as by_name
        from ex.backup_log b left join ex.app_user u on u.id = b.created_by
       order by b.created_at desc limit 50`;
    const [{ d }] = await tx<{ d: number | null }[]>`select (ex.fn_company_today() - max(created_at)::date)::int as d from ex.backup_log`;
    return { backups, daysSinceLast: d };
  });
}

/**
 * The company backup as a ZIP stream — the same bytes the portal's Backup page downloads.
 * The caller decides how it is authenticated (cookie + same-origin, or bearer) and rate-limited.
 */
export async function backupStream(s: Session, includeAudit: boolean): Promise<{ fileName: string; stream: ReadableStream<Uint8Array> }> {
  await assertPermission("backup.manage", s);
  const tenant = await tenantOf(s);
  const [company] = await withTenant(tenant, (tx) =>
    tx<{ id: string; code: string; name: string; today: string }[]>`
      select id, code, coalesce(display_name, legal_name) as name,
             to_char(now() at time zone coalesce(timezone, 'Asia/Kolkata'), 'YYYY-MM-DD_HH24MI') as today
        from ex.company`);
  const fileName = `fx-backup_${company.code}_${company.today}${includeAudit ? "_with-audit" : ""}.zip`;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      withTenant(
        tenant,
        async (tx) => {
          const tables = backupTables(includeAudit);
          const counts = await countRows(tx, tables);
          // recorded in its own (write) transaction; the data below comes from the read-only snapshot
          await withTenant(tenant, (w) => w`select ex.fn_record_backup(${w.json({
            file_name: fileName, include_audit: includeAudit, table_count: tables.length,
            row_count: Object.values(counts).reduce((a, b) => a + b, 0), schema_version: SCHEMA_VERSION,
          })})`);
          await writeBackup(tx, { company: { id: Number(company.id), code: company.code, name: company.name }, by: { id: s.userId, name: s.userName }, includeAudit, counts }, (c) => controller.enqueue(c));
        },
        { snapshot: true },
      ).then(
        () => controller.close(),
        (e) => {
          console.error("backup failed", e);
          controller.error(e);
        },
      );
    },
  });
  return { fileName, stream };
}
