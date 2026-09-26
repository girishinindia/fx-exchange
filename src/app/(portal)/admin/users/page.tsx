import type { Metadata } from "next";
import { Badge, Card, Icon, Kpi, Note, PageHeader, Table } from "@/components/ui";
import { withTenant } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { requirePermission } from "@/lib/permissions";
import { tenantOf } from "@/lib/session";

export const metadata: Metadata = { title: "People" };

type Row = {
  id: string; full_name: string; email: string; phone: string | null;
  user_type: "ADMIN" | "USER"; status: "ACTIVE" | "INACTIVE" | "LOCKED";
  role_name: string | null; last_login_at: Date | null; locked: boolean;
  must_change_password: boolean; profile_done: boolean;
};

/**
 * Who works at this desk — and that is all. Accounts are opened, blocked and reset by Genius
 * ITens, not here, so that nobody inside a company can quietly widen their own access or
 * somebody else's. This page exists so an Administrator can see who their people are and match
 * a name on a voucher to a person.
 */
export default async function PeoplePage() {
  const s = await requirePermission("user.view");
  if (s.preview) return <Note tone="amber">People need a real login (not available in preview).</Note>;

  const rows = await withTenant(await tenantOf(s), (tx) => tx<Row[]>`
    select u.id, u.full_name, u.email, u.phone, u.user_type, u.status,
           r.name as role_name, u.last_login_at,
           coalesce(u.locked_until > now(), false) as locked, u.must_change_password,
           u.profile_completed_at is not null as profile_done
      from ex.app_user u
      left join lateral (select ur.role_id from ex.user_role ur where ur.user_id = u.id order by ur.id limit 1) x on true
      left join ex.role r on r.id = x.role_id
     order by (u.user_type = 'ADMIN') desc, u.full_name`);

  const active = rows.filter((r) => r.status === "ACTIVE").length;

  return (
    <>
      <PageHeader title="People" crumbs={["Administration"]}
        subtitle="Everybody who can sign in to this company. There is no self sign-up." />

      <div className="grid sm:grid-cols-3 gap-4">
        <Kpi label="People" value={rows.length} sub={`${active} working · ${rows.length - active} blocked`} icon="fa-users" />
        <Kpi label="Administrators" value={rows.filter((r) => r.user_type === "ADMIN").length} sub="run the company" icon="fa-crown" tone="sky" />
        <Kpi label="Locked out" value={rows.filter((r) => r.locked).length} sub="after 5 wrong passwords; clears itself in 15 minutes" icon="fa-user-lock" tone={rows.some((r) => r.locked) ? "rose" : "slate"} />
      </div>

      <Note tone="sky" icon="fa-shield-halved">
        <b>Genius ITens adds and removes people.</b> Nobody inside a company — not even an
        Administrator — can create an account, change what somebody may do, or block them. That is
        deliberate: it means access to your books can only ever be widened by a third party, and
        every such change is recorded against a named person at Genius ITens.
        <div className="mt-1">
          To add somebody, block somebody who has left, or reset a forgotten password, telephone
          or email Genius ITens. It takes about a minute.
        </div>
      </Note>

      <Card padded={false}>
        <Table<Row>
          rowKey={(u) => u.id}
          columns={[
            { key: "name", header: "Name", render: (u) => (
              <>
                <div className="font-medium">{u.full_name}{String(u.id) === String(s.userId) && <span className="ml-2 text-xs text-slate-400">you</span>}</div>
                <div className="text-xs text-slate-500">{u.email}{u.phone ? ` · ${u.phone}` : ""}</div>
              </>) },
            { key: "may", header: "May do", render: (u) => (
              <Badge tone={u.user_type === "ADMIN" ? "violet" : "sky"}>{u.role_name ?? (u.user_type === "ADMIN" ? "Administrator" : "Desk user")}</Badge>) },
            { key: "state", header: "State", render: (u) => (
              u.status !== "ACTIVE" ? <Badge tone="rose"><Icon name="fa-ban" />Blocked</Badge>
              : u.locked ? <Badge tone="rose"><Icon name="fa-user-lock" />Locked out</Badge>
              : u.must_change_password ? <Badge tone="amber">Has not signed in</Badge>
              : !u.profile_done ? <Badge tone="amber">Profile not filled in</Badge>
              : <Badge tone="emerald"><Icon name="fa-circle-check" />Working</Badge>) },
            { key: "last", header: "Last sign-in", align: "right", render: (u) => (
              <span className="text-slate-500">{u.last_login_at ? fmtDateTime(u.last_login_at) : "never"}</span>) },
          ]}
          rows={rows}
        />
      </Card>
    </>
  );
}
