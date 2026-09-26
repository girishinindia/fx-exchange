import type { Metadata } from "next";
import { signOutEverywhere, signOutSession } from "@/app/actions/auth";
import { ChangePasswordForm } from "@/components/forms";
import { Badge, Button, Card, PageHeader, Table } from "@/components/ui";
import { withTenant } from "@/lib/db";
import { deviceLabel, fmtDateTime, initials } from "@/lib/format";
import { listSessions, requireSession, tenantOf } from "@/lib/session";

export const metadata: Metadata = { title: "My profile" };

type LoginRow = { id: string; login_at: Date; success: boolean; failure_reason: string | null; ip_address: string | null; user_agent: string | null };

const REASONS: Record<string, string> = { wrong_password: "Wrong password", locked: "Account locked", user_inactive: "User disabled", company_inactive: "Company inactive" };

export default async function ProfilePage() {
  const s = await requireSession();
  const [sessions, history] = s.preview
    ? [[], [] as LoginRow[]]
    : await Promise.all([
        listSessions(s),
        withTenant(await tenantOf(s), (tx) => tx<LoginRow[]>`
          select id, login_at, success, failure_reason, host(ip_address) as ip_address, user_agent
            from ex.login_history where user_id = ${s.userId} order by login_at desc limit 20`),
      ]);

  return (
    <>
      <PageHeader title="My profile" crumbs={["Account"]} />
      <div className="grid xl:grid-cols-3 gap-6 items-start">
        <Card>
          <div className="text-center">
            <div className="mx-auto h-20 w-20 rounded-full bg-sky-100 text-sky-700 grid place-items-center text-2xl font-bold">{initials(s.userName)}</div>
            <div className="mt-3 font-bold text-lg">{s.userName}</div>
            <div className="text-sm text-slate-500">{s.email}</div>
            <div className="mt-2">
              <Badge tone={s.userType === "ADMIN" ? "sky" : "slate"}>{s.userType === "ADMIN" ? "Admin" : "User"}</Badge>
            </div>
            <div className="mt-4 text-sm text-slate-500">
              {s.counterName ?? "—"} · {s.companyName} ({s.companyCode})
            </div>
          </div>
        </Card>

        <div className="xl:col-span-2 space-y-6">
          <Card title="Change password" icon="fa-key">
            <div className="max-w-md">
              <ChangePasswordForm forced={false} />
            </div>
          </Card>

          <Card
            title="Active sessions"
            icon="fa-laptop"
            padded={false}
            actions={
              <form action={signOutEverywhere}>
                <Button type="submit" variant="danger" icon="fa-right-from-bracket">
                  Sign out everywhere
                </Button>
              </form>
            }
          >
            <Table
              rows={sessions}
              rowKey={(r) => r.sid}
              empty="No sessions"
              columns={[
                { key: "d", header: "Device", render: (r) => <span>{deviceLabel(r.userAgent)}{r.current && <span className="ml-2 text-xs text-emerald-600">(this device)</span>}</span> },
                { key: "ip", header: "IP", render: (r) => r.ip ?? "—" },
                { key: "t", header: "Signed in", render: (r) => fmtDateTime(r.createdAt) },
                {
                  key: "a",
                  header: "",
                  align: "right",
                  render: (r) =>
                    r.current ? null : (
                      <form action={signOutSession}>
                        <input type="hidden" name="sid" value={r.sid} />
                        <Button type="submit" variant="ghost">Sign out</Button>
                      </form>
                    ),
                },
              ]}
            />
          </Card>

          <Card title="Login history" icon="fa-clock-rotate-left" padded={false}>
            <Table
              rows={history}
              rowKey={(r) => r.id}
              empty="No logins yet"
              columns={[
                { key: "t", header: "When", render: (r) => fmtDateTime(r.login_at) },
                { key: "r", header: "Result", render: (r) => (r.success ? <Badge tone="emerald">Success</Badge> : <Badge tone="rose">{REASONS[r.failure_reason ?? ""] ?? "Failed"}</Badge>) },
                { key: "ip", header: "IP", render: (r) => r.ip_address ?? "—" },
                { key: "d", header: "Device", render: (r) => deviceLabel(r.user_agent) },
              ]}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
