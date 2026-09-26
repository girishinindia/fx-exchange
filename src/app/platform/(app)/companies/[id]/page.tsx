import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge, Card, Icon, Note, PageHeader, Table } from "@/components/ui";
import { AddPersonButton, CompanyStatusButton, DeleteCompanyPanel, PersonActions } from "@/components/platform-forms";
import { requirePlatformSession } from "@/lib/platform-session";
import { describeAction } from "@/lib/platform-actions";
import { auditTrail, getCompany, type CompanyUser } from "@/server/platform";

export const metadata: Metadata = { title: "Company" };
export const dynamic = "force-dynamic";

const when = (d: string | null) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "never";

export default async function CompanyPage({ params }: PageProps<"/platform/companies/[id]">) {
  const s = await requirePlatformSession();
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const found = await getCompany(s, id);
  if (!found) notFound();
  const { company, users } = found;
  const trail = await auditTrail(s, id, 20);

  return (
    <div className="space-y-6">
      <PageHeader
        title={company.name}
        crumbs={["Companies", company.code]}
        subtitle={<>Code <b>{company.code}</b> · books in {company.base_currency} · {company.is_set_up ? <>deals in <b>{company.primary_currency}</b></> : "not set up yet"}</>}
        actions={<CompanyStatusButton company={company} />}
      />

      {company.status !== "ACTIVE" && (
        <Note tone="rose" icon="fa-ban">
          This company is blocked. Nobody there can sign in. Their books are untouched and come
          back exactly as they were the moment the account is let back in.
        </Note>
      )}
      {!company.is_set_up && (
        <Note tone="amber" icon="fa-hourglass-half">
          Waiting for its first Administrator to sign in. They will name the company properly and
          choose the currency the desk deals in — which cannot be changed afterwards — before any
          other screen opens to them.
        </Note>
      )}

      <Card title="People" icon="fa-users" padded={false}
            actions={<AddPersonButton companyId={company.id} companyCode={company.code} />}>
        <Table<CompanyUser>
          rowKey={(u) => u.id}
          columns={[
            { key: "name", header: "Name", render: (u) => (
              <>
                <div className="font-medium">{u.full_name}</div>
                <div className="text-xs text-slate-500">{u.email}{u.phone ? ` · ${u.phone}` : ""}</div>
              </>) },
            { key: "type", header: "May do", render: (u) => (
              <Badge tone={u.user_type === "ADMIN" ? "violet" : "sky"}>
                {u.user_type === "ADMIN" ? "Administrator" : "Desk user"}
              </Badge>) },
            { key: "state", header: "State", render: (u) => (
              u.status !== "ACTIVE" ? <Badge tone="rose"><Icon name="fa-ban" />Blocked</Badge>
              : u.must_change_password ? <Badge tone="amber">Has not signed in</Badge>
              : !u.profile_done ? <Badge tone="amber">Profile not filled in</Badge>
              : <Badge tone="emerald"><Icon name="fa-circle-check" />Working</Badge>) },
            { key: "last", header: "Last sign-in", render: (u) => <span className="text-slate-500">{when(u.last_login_at)}</span> },
            { key: "do", header: "", align: "right", render: (u) => <PersonActions companyId={company.id} user={u} /> },
          ]}
          rows={users}
        />
      </Card>

      <DeleteCompanyPanel
        company={{ id: company.id, code: company.code, name: company.name, status: company.status }}
        people={users.length}
      />

      <Card title="What has been done to this account" icon="fa-clock-rotate-left" padded={false}>
        {trail.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">Nothing yet.</p>
        ) : (
          <Table<(typeof trail)[number]>
            rowKey={(a) => a.id}
            columns={[
              { key: "at", header: "When", render: (a) => <span className="text-slate-500">{when(a.at)}</span> },
              { key: "who", header: "By", render: (a) => a.who },
              { key: "what", header: "What", render: (a) => describeAction(a.action, a.detail) },
            ]}
            rows={trail}
          />
        )}
      </Card>
    </div>
  );
}
