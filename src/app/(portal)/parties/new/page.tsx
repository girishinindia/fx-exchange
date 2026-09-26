import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/permissions";
import { PartyForm } from "../PartyForm";

export const metadata: Metadata = { title: "Add party" };

export default async function NewPartyPage() {
  await requirePermission("party.manage");
  return (
    <>
      <PageHeader title="Add a depositor or client" crumbs={["Parties"]} subtitle="One record per firm or person. Tick both boxes if they do both." />
      <Card className="max-w-3xl"><PartyForm /></Card>
    </>
  );
}
