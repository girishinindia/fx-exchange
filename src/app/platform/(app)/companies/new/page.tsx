import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { NewCompanyForm } from "@/components/platform-forms";
import { requirePlatformSession } from "@/lib/platform-session";

export const metadata: Metadata = { title: "Open an account" };
export const dynamic = "force-dynamic";

/** The page that could not exist before: a company is created here and nowhere else. */
export default async function NewCompanyPage() {
  await requirePlatformSession();
  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader title="Open an account" crumbs={["Companies"]}
        subtitle="A company and its first Administrator. Two minutes' work, and then it is theirs." />
      <Card><NewCompanyForm /></Card>
    </div>
  );
}
