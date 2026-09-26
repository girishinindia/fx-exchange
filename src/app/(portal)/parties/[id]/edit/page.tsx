import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/permissions";
import { getParty } from "@/server/services/parties";
import { PartyForm } from "../../PartyForm";

export const metadata: Metadata = { title: "Edit party" };

export default async function EditPartyPage({ params }: PageProps<"/parties/[id]">) {
  const s = await requirePermission("party.manage");
  const { id } = await params;
  const party = await getParty(s, Number(id));
  if (!party) notFound();
  return (
    <>
      <PageHeader title={`Edit ${party.full_name}`} crumbs={["Parties"]} subtitle={party.party_code} />
      <Card className="max-w-3xl"><PartyForm party={party} /></Card>
    </>
  );
}
