import type { Metadata } from "next";
import { Card, Icon, Note, PageHeader } from "@/components/ui";
import { withTenant } from "@/lib/db";
import { requirePermission } from "@/lib/permissions";
import { tenantOf } from "@/lib/session";

export const metadata: Metadata = { title: "What each person may do" };

type Role = { id: string; code: string; name: string; description: string | null; users: number; perms: string[] };
type Perm = { code: string; module: string; description: string };

/**
 * What the two kinds of person may do, to read, not to change. The Administrator can see exactly
 * what a desk user is and is not allowed to touch — which is the question this page is actually
 * asked — without being able to widen it.
 */
export default async function RolesPage() {
  const s = await requirePermission("user.view");
  if (s.preview) return <Note tone="amber">This needs a real login (not available in preview).</Note>;

  const { roles, perms } = await withTenant(await tenantOf(s), async (tx) => {
    const roles = await tx<Role[]>`
      select r.id, r.code, r.name, r.description,
             (select count(*)::int from ex.user_role ur where ur.role_id = r.id) as users,
             coalesce((select array_agg(rp.permission_code) from ex.role_permission rp where rp.role_id = r.id), '{}') as perms
        from ex.role r order by (r.code = 'ADMIN') desc, r.name`;
    const perms = await tx<Perm[]>`select code, module, description from ex.permission order by module, code`;
    return { roles, perms };
  });

  const modules = [...new Set(perms.map((p) => p.module))];

  return (
    <>
      <PageHeader title="What each person may do" crumbs={["Administration"]}
        subtitle="The two kinds of account at this desk, and exactly what each one can reach." />

      <Note tone="sky" icon="fa-shield-halved">
        This is set by Genius ITens and is the same at every desk they run. Keeping it out of the
        company&apos;s hands is what makes it worth something: a person who could widen their own
        access could quietly give themselves the books.
      </Note>

      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-sky-50/70">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">What it covers</th>
                {roles.map((r) => (
                  <th key={r.id} className="px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">
                    {r.name}
                    <div className="font-normal normal-case tracking-normal text-slate-400">{r.users} {r.users === 1 ? "person" : "people"}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modules.map((m) => (
                <>
                  <tr key={m} className="bg-slate-50/70">
                    <td className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500" colSpan={roles.length + 1}>{m}</td>
                  </tr>
                  {perms.filter((p) => p.module === m).map((p) => (
                    <tr key={p.code} className="border-t border-sky-50">
                      <td className="px-4 py-2">{p.description}</td>
                      {roles.map((r) => (
                        <td key={r.id} className="px-4 py-2 text-center">
                          {r.perms.includes(p.code)
                            ? <Icon name="fa-circle-check" className="text-emerald-600" />
                            : <span className="text-slate-300">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
