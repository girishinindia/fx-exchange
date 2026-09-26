import type { Metadata } from "next";
import Link from "next/link";
import { Card, Icon, Note, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "API & mobile app" };

const curl = (base: string) => `# 1. sign in — an email address or a mobile number, no company code
curl -X POST ${base}/api/v1/auth/login \\
  -H 'content-type: application/json' \\
  -d '{"login":"you@example.com","password":"••••••••"}'

# 2. use the access token
curl ${base}/api/v1/me -H 'authorization: Bearer <accessToken>'

# 3. post a deposit (idempotent: the same clientRef never posts twice)
curl -X POST ${base}/api/v1/vouchers \\
  -H 'authorization: Bearer <accessToken>' -H 'content-type: application/json' \\
  -d '{
    "type": "DEPOSIT", "date": "2026-04-01", "partyId": 12, "clientRef": "mobile-9f31",
    "narration": "USD 10,000 @ 86.00 from Rajesh Traders",
    "lines": [
      {"accountCode":"CASH-USD","currency":"USD","fxAmount":"10000","rate":"86","dc":"D"},
      {"accountCode":"DEP-PAY","partyId":12,"currency":"INR","fxAmount":"860000","rate":"1","dc":"C"}
    ]
  }'`;

export default async function ApiPage() {
  await requireAdmin();
  const base = process.env.APP_URL ?? "https://your-domain";

  return (
    <>
      <PageHeader
        title="API & mobile app"
        crumbs={["Administration"]}
        subtitle="The portal and the mobile app use the same API and the same rules. Nothing extra to install — it ships with this site."
      />
      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <Card title="How a device signs in" icon="fa-mobile-screen">
          <ol className="list-decimal pl-5 space-y-2 text-sm text-slate-600">
            <li>The app posts an email address <i>or</i> a mobile number, and a password, to <code className="text-xs bg-slate-100 px-1 rounded">/api/v1/auth/login</code>. There is no company code — a person belongs to one company and the server works out which.</li>
            <li>It stores the <b>access token</b> (8 hours) and the <b>refresh token</b> (30 days) in the phone&apos;s secure storage.</li>
            <li>Every call sends <code className="text-xs bg-slate-100 px-1 rounded">Authorization: Bearer &lt;accessToken&gt;</code>.</li>
            <li>When a call returns 401, the app refreshes with <code className="text-xs bg-slate-100 px-1 rounded">/api/v1/auth/refresh</code> and retries once.</li>
          </ol>
          <Note tone="slate" icon="fa-shield-halved">
            A user needs the <b>API access</b> permission. Resetting a password, disabling a user or “sign out everywhere”
            kills that person&apos;s phone tokens immediately, and every call is in the audit trail like any portal action.
          </Note>
        </Card>
        <Card title="Endpoints" icon="fa-plug">
          <ul className="text-sm text-slate-600 space-y-1.5">
            <li><code className="text-xs bg-slate-100 px-1 rounded">POST /api/v1/auth/login · refresh · logout</code></li>
            <li><code className="text-xs bg-slate-100 px-1 rounded">GET /api/v1/me</code> — user, company, permissions</li>
            <li><code className="text-xs bg-slate-100 px-1 rounded">GET·POST /api/v1/parties</code>, <code className="text-xs bg-slate-100 px-1 rounded">GET·PATCH /api/v1/parties/&#123;id&#125;</code> (add <code className="text-xs">?ledger=1</code>)</li>
            <li><code className="text-xs bg-slate-100 px-1 rounded">GET·POST /api/v1/accounts</code></li>
            <li><code className="text-xs bg-slate-100 px-1 rounded">GET·POST /api/v1/vouchers</code>, <code className="text-xs bg-slate-100 px-1 rounded">GET /api/v1/vouchers/&#123;id&#125;</code></li>
            <li><code className="text-xs bg-slate-100 px-1 rounded">GET /api/v1/reports/trial-balance · party-balances · currency-position</code></li>
          </ul>
          <p className="mt-3 text-sm">
            Full contract: <Link href="/api/v1/openapi" className="text-sky-700 underline">/api/v1/openapi</Link> (OpenAPI 3.1 — paste it into Postman or an SDK generator).
          </p>
        </Card>
      </div>
      <Card title="Try it" icon="fa-terminal">
        <pre className="overflow-x-auto rounded-xl bg-slate-900 p-4 text-xs leading-relaxed text-slate-100"><code>{curl(base)}</code></pre>
        <p className="mt-3 text-xs text-slate-500"><Icon name="fa-circle-info" className="mr-1" />Every write is a voucher, so the mobile app can never put the books out of balance — the database refuses anything that does not balance.</p>
      </Card>
    </>
  );
}
