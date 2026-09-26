import type { Metadata } from "next";
import { saveBooks, saveCompanyProfile } from "@/app/actions/settings";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, Field, Note, PageHeader } from "@/components/ui";
import { Tabs } from "@/components/ui/client";
import { withTenant } from "@/lib/db";
import { requirePermission } from "@/lib/permissions";
import { tenantOf } from "@/lib/session";

export const metadata: Metadata = { title: "Company settings" };

type Company = {
  code: string; legal_name: string; display_name: string | null; gstin: string | null; pan: string | null; license_no: string | null;
  phone: string | null; email: string | null; address: string | null; city: string | null; state: string | null; pincode: string | null;
  base_currency_code: string; primary_currency_code: string; primary_currency_locked: boolean; books_start_date: string | null;
  vouchers: number;
};

export default async function SettingsPage() {
  const s = await requirePermission("company.manage");
  if (s.preview) return <Note tone="amber">Settings need a real login.</Note>;

  const { c, fys } = await withTenant(await tenantOf(s), async (tx) => {
    const [c] = await tx<Company[]>`
      select *, to_char(books_start_date, 'YYYY-MM-DD') as books_start_date,
             (select count(*)::int from ex.voucher) as vouchers
        from ex.company where id = ${s.companyId}`;
    const fys = await tx<{ fy_code: string; start_date: string; end_date: string; status: string; vouchers: number }[]>`
      select f.fy_code, to_char(f.start_date, 'YYYY-MM-DD') as start_date, to_char(f.end_date, 'YYYY-MM-DD') as end_date, f.status,
             (select count(*)::int from ex.voucher v where v.fy_id = f.id) as vouchers
        from ex.fy_period f order by f.start_date desc`;
    return { c, fys };
  });

  const profile = (
    <div className="p-5">
      <ActionForm action={saveCompanyProfile} submit="Save profile">
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Company code" value={c.code} disabled hint="Used at sign-in · cannot be changed" />
          <Field label="Legal name" name="legalName" defaultValue={c.legal_name} required />
          <Field label="Display name" name="displayName" defaultValue={c.display_name ?? ""} hint="Shown in the sidebar and on printed pages" />
          <Field label="GSTIN" name="gstin" defaultValue={c.gstin ?? ""} className="[&_input]:uppercase" />
          <Field label="PAN" name="pan" defaultValue={c.pan ?? ""} className="[&_input]:uppercase" />
          <Field label="RBI / FFMC licence no." name="licenseNo" defaultValue={c.license_no ?? ""} />
          <Field label="Phone" name="phone" defaultValue={c.phone ?? ""} />
          <Field label="Email" name="email" type="email" defaultValue={c.email ?? ""} />
          <Field label="Address" name="address" defaultValue={c.address ?? ""} className="md:col-span-2" />
          <Field label="City" name="city" defaultValue={c.city ?? ""} />
          <Field label="State" name="state" defaultValue={c.state ?? ""} />
          <Field label="PIN code" name="pincode" defaultValue={c.pincode ?? ""} />
        </div>
      </ActionForm>
    </div>
  );

  const books = (
    <div className="p-5 space-y-5">
      <Note icon="fa-lock">
        The <b>dealing currency</b> was chosen when this company was set up, and locked the moment
        it was. Every deposit the desk has ever taken is in it and every deal is priced from it, so
        there is no way to change it — not here, and not by Genius ITens either.
      </Note>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-sm font-medium text-slate-700">Book currency</div>
          <div className="mt-0.5 text-lg font-semibold text-slate-800">{c.base_currency_code.trim()}</div>
          <div className="text-xs text-slate-500">Every ledger, trial balance and report totals in this.</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-sm font-medium text-slate-700">Dealing currency</div>
          <div className="mt-0.5 text-lg font-semibold text-slate-800">{c.primary_currency_code.trim()}</div>
          <div className="text-xs text-slate-500">What depositors bring in — locked, and can never be changed.</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-sm font-medium text-slate-700">Financial year</div>
          <div className="mt-0.5 text-sm text-slate-800">1 April – 31 March</div>
          <div className="text-xs text-slate-500">The Indian financial year. Fixed for every company.</div>
        </div>
        <ActionForm action={saveBooks} submit="Save">
          <Field label="Books start date" name="booksStart" type="date" defaultValue={c.books_start_date ?? ""} hint="The date of the opening balance voucher" />
        </ActionForm>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Financial years</h3>
        <table className="w-full text-sm">
          <thead className="bg-sky-50/70">
            <tr>{["Year", "From", "To", "Vouchers", "Status"].map((h, i) => <th key={h} className={`px-4 py-2 text-xs font-semibold uppercase text-slate-500 ${i === 3 ? "text-right" : "text-left"}`}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {fys.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">A financial year is created with the first voucher.</td></tr>}
            {fys.map((f) => (
              <tr key={f.fy_code} className="border-t border-sky-50">
                <td className="px-4 py-2 font-medium">{f.fy_code}</td>
                <td className="px-4 py-2 text-slate-600">{f.start_date}</td>
                <td className="px-4 py-2 text-slate-600">{f.end_date}</td>
                <td className="px-4 py-2 text-right tabular-nums">{f.vouchers}</td>
                <td className="px-4 py-2">{f.status === "LOCKED" ? <Badge tone="slate">Locked</Badge> : <Badge tone="emerald">Open</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500">Closing a year after the CA signs off arrives with Phase 12.</p>
      </div>
    </div>
  );

  return (
    <>
      <PageHeader title="Company settings" crumbs={["Administration"]} subtitle="Company details printed on documents, and the rules the books run on." />
      <Card padded={false}>
        <Tabs tabs={[{ key: "profile", label: "Company profile", content: profile }, { key: "books", label: "Books & currency", content: books }]} />
      </Card>
    </>
  );
}
