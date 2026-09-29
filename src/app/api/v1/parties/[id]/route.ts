import { ApiProblem, json, readJson, requirePermissionApi, withApi } from "@/lib/api";
import { getParty, partyInsight, saveParty, type PartyInput } from "@/server/services/parties";
import { hasPermission } from "@/lib/permissions";
import { partyLedger } from "@/server/services/ledger";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/parties/{id}?ledger=1&from=&to=
 * With report.view the answer also carries `insight` — what the portal's party page shows
 * beside the ledger: rupees owed, currency still to deliver per currency, what a depositor is
 * owed in currency, their money round the loop (`cycle`) and what they have earned the desk
 * (`earned`). Without report.view `insight` is null.
 */
export const GET = withApi(async (req, s, ctx) => {
  const { id } = await ctx.params;
  const party = await getParty(s, Number(id));
  if (!party) throw new ApiProblem("not_found", "Party not found.", 404);
  const wantLedger = req.nextUrl.searchParams.get("ledger") === "1";
  const canReport = await hasPermission(s, "report.view");
  const [ledger, insight] = await Promise.all([
    wantLedger && canReport ? partyLedger(s, Number(id), req.nextUrl.searchParams.get("from") ?? undefined, req.nextUrl.searchParams.get("to") ?? undefined) : Promise.resolve(null),
    canReport ? partyInsight(s, Number(id), party.is_depositor) : Promise.resolve(null),
  ]);
  return json({ party, ledger, insight });
});

/** PATCH /api/v1/parties/{id} */
export const PATCH = withApi(async (req, s, ctx) => {
  await requirePermissionApi(s, "party.manage");
  const { id } = await ctx.params;
  const current = await getParty(s, Number(id));
  if (!current) throw new ApiProblem("not_found", "Party not found.", 404);
  const body = await readJson<Partial<PartyInput>>(req);
  const saved = await saveParty(s, {
    id: Number(id),
    fullName: body.fullName ?? current.full_name,
    partyForm: (body.partyForm ?? current.party_form) as "INDIVIDUAL" | "BUSINESS",
    isDepositor: body.isDepositor ?? current.is_depositor,
    isClient: body.isClient ?? current.is_client,
    phone: body.phone ?? current.phone,
    email: body.email ?? current.email,
    address: body.address ?? current.address,
    city: body.city ?? current.city,
    nationality: body.nationality ?? current.nationality,
    idProofType: body.idProofType ?? current.id_proof_type,
    idProofNumber: body.idProofNumber ?? current.id_proof_number,
    gstin: body.gstin ?? current.gstin,
    notes: body.notes ?? current.notes,
    isActive: body.isActive ?? current.is_active,
  });
  return json(saved);
});
