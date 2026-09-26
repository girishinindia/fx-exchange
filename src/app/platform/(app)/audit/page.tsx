import type { Metadata } from "next";
import { Card, PageHeader, Table } from "@/components/ui";
import { describeAction } from "@/lib/platform-actions";
import { requirePlatformSession } from "@/lib/platform-session";
import { auditTrail, type AuditRow } from "@/server/platform";

export const metadata: Metadata = { title: "What has been done" };
export const dynamic = "force-dynamic";

const when = (d: string) =>
  new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Every account opened, blocked or changed, by whom and when. Added to, never edited. */
export default async function AuditPage() {
  const s = await requirePlatformSession();
  const rows = await auditTrail(s, undefined, 300);

  return (
    <div className="space-y-6">
      <PageHeader title="What has been done"
        subtitle="Every account opened, every person added, every block — with who did it and when. Nothing here can be changed or removed." />
      <Card padded={false}>
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">Nothing yet.</p>
        ) : (
          <Table<AuditRow>
            rowKey={(a) => a.id}
            columns={[
              { key: "at", header: "When", render: (a) => <span className="text-slate-500 whitespace-nowrap">{when(a.at)}</span> },
              { key: "who", header: "By", render: (a) => a.who },
              { key: "co", header: "Company", render: (a) => a.company_code ?? "—" },
              { key: "what", header: "What", render: (a) => describeAction(a.action, a.detail) },
              { key: "detail", header: "Detail", render: (a) => (
                <span className="text-xs text-slate-500">
                  {Object.entries(a.detail ?? {}).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                </span>) },
            ]}
            rows={rows}
          />
        )}
      </Card>
    </div>
  );
}
