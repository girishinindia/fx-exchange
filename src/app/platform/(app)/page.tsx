import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, EmptyState, Icon, Kpi, LinkButton, Note, PageHeader, Table } from "@/components/ui";
import { requirePlatformSession } from "@/lib/platform-session";
import { listCompanies, type Company } from "@/server/platform";

export const metadata: Metadata = { title: "Companies" };
export const dynamic = "force-dynamic";

const statusTone = (s: string) => (s === "ACTIVE" ? "emerald" : s === "SUSPENDED" ? "rose" : "slate");
const when = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

export default async function CompaniesPage({ searchParams }: PageProps<"/platform">) {
  const s = await requirePlatformSession();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? (sp.q as string) : undefined;
  // set by the delete, which cannot report back from a page that no longer exists
  const deleted = typeof sp.deleted === "string" ? (sp.deleted as string) : undefined;
  const held = typeof sp.held === "string" ? (sp.held as string) : undefined;
  const companies = await listCompanies(s, q);

  const live = companies.filter((c) => c.status === "ACTIVE").length;
  const waiting = companies.filter((c) => !c.is_set_up).length;
  const blocked = companies.filter((c) => c.status !== "ACTIVE").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Companies"
        subtitle="Every desk Genius ITens runs. Open an account here; the company sets itself up."
        actions={<LinkButton href="/platform/companies/new" icon="fa-plus">Open an account</LinkButton>}
      />

      {deleted && (
        <Note tone="emerald" icon="fa-circle-check">
          <b>{deleted}</b> has been deleted, with everything it owned.
          {held ? ` It was holding ${held}, and none of it can be recovered.` : " It had never been used."}
          {" "}The trail below keeps who did it and why.
        </Note>
      )}

      <div className="grid sm:grid-cols-3 gap-4">
        <Kpi label="Running" value={live} icon="fa-circle-check" tone="emerald" />
        <Kpi label="Not set up yet" value={waiting} icon="fa-hourglass-half" tone="amber"
             sub={waiting ? "Their Administrator has not signed in" : undefined} />
        <Kpi label="Blocked" value={blocked} icon="fa-ban" tone={blocked ? "rose" : "slate"} />
      </div>

      <Card padded={false}>
        <form className="flex gap-2 p-4 border-b border-sky-50">
          <input name="q" defaultValue={q ?? ""} placeholder="Company name or code"
                 className="flex-1 rounded-lg border border-sky-200 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300" />
          <button type="submit" className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700">Search</button>
        </form>
        {companies.length === 0 ? (
          <div className="p-6">
            <EmptyState icon="fa-building" title={q ? "Nothing matches that" : "No companies yet"}
              text={q ? "Try a different name or code." : "Open the first account to get started."}
              action={<LinkButton href="/platform/companies/new" icon="fa-plus">Open an account</LinkButton>} />
          </div>
        ) : (
          <Table<Company>
            rowKey={(c) => c.id}
            columns={[
              { key: "code", header: "Code", render: (c) => (
                <Link href={`/platform/companies/${c.id}`} className="font-semibold text-sky-700 hover:underline">{c.code}</Link>) },
              { key: "name", header: "Company", render: (c) => (
                <>
                  <div className="font-medium">{c.name}</div>
                  {!c.is_set_up && <div className="text-xs text-amber-700">waiting to be set up</div>}
                </>) },
              { key: "deals", header: "Deals in", render: (c) => (c.is_set_up ? c.primary_currency : "—") },
              { key: "people", header: "People", align: "right", render: (c) => `${c.users} (${c.admins} admin)` },
              { key: "last", header: "Last sign-in", render: (c) => when(c.last_login_at) },
              { key: "status", header: "", align: "right", render: (c) => (
                <Badge tone={statusTone(c.status)}>
                  <Icon name={c.status === "ACTIVE" ? "fa-circle-check" : "fa-ban"} />
                  {c.status === "ACTIVE" ? "Running" : c.status === "SUSPENDED" ? "Blocked" : "Closed"}
                </Badge>) },
            ]}
            rows={companies}
          />
        )}
      </Card>
    </div>
  );
}
