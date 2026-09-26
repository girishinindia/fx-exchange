"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { checkbox, fieldErrors, optId, optText, runAction, type ActionState } from "@/lib/action";
import { assertPermission } from "@/lib/permissions";
import { saveParty } from "@/server/services/parties";

const ID_TYPES = ["PASSPORT", "AADHAAR", "PAN", "DRIVING_LICENSE", "VOTER_ID", "OTHER"] as const;

const Party = z
  .object({
    id: optId(),
    partyForm: z.enum(["INDIVIDUAL", "BUSINESS"]),
    fullName: z.string().trim().min(2, "Enter the name").max(160),
    isDepositor: checkbox,
    isClient: checkbox,
    phone: optText(20).refine((v) => v === null || /^[0-9+\- ]{8,20}$/.test(v), "Mobile: digits only"),
    email: optText(200).refine((v) => v === null || z.string().email().safeParse(v).success, "Enter a valid email"),
    address: optText(300),
    city: optText(80),
    nationality: optText(60),
    idProofType: z.enum(ID_TYPES).optional().or(z.literal("").transform(() => undefined)),
    idProofNumber: optText(40),
    gstin: optText(20).refine((v) => v === null || /^[0-9A-Z]{15}$/.test(v.toUpperCase()), "GSTIN must be 15 characters"),
    notes: optText(500),
    active: checkbox,
  })
  .refine((v) => v.isDepositor || v.isClient, { path: ["isDepositor"], message: "Tick depositor, client, or both" })
  .refine((v) => !v.idProofNumber || v.idProofType, { path: ["idProofType"], message: "Choose the ID proof type" });

/** Add or edit a depositor / client. */
export async function savePartyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let target = "";
  const res = await runAction(async () => {
    const s = await assertPermission("party.manage");
    const raw = Object.fromEntries(fd);
    const v = Party.safeParse({ ...raw, id: raw.id || undefined, active: raw.active ?? (raw.id ? "" : "on") });
    if (!v.success) return { fieldErrors: fieldErrors(v.error) };
    const d = v.data;
    const saved = await saveParty(s, {
      id: d.id,
      fullName: d.fullName,
      partyForm: d.partyForm,
      isDepositor: d.isDepositor,
      isClient: d.isClient,
      phone: d.phone,
      email: d.email,
      address: d.address,
      city: d.city,
      nationality: d.nationality,
      idProofType: d.idProofType ?? null,
      idProofNumber: d.idProofNumber,
      gstin: d.gstin?.toUpperCase() ?? null,
      notes: d.notes,
      isActive: d.active,
    });
    revalidatePath("/parties");
    target = `/parties/${saved.id}`;
    return { ok: true, message: `${d.fullName} saved (${saved.partyCode}).` };
  });
  if (res.ok && target) redirect(target);
  return res;
}
