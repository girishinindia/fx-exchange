"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { checkbox, fieldErrors, optId, optText, runAction, type ActionState } from "@/lib/action";
import { assertPermission } from "@/lib/permissions";
import { saveParty } from "@/server/services/parties";

// A party is a name and a way to reach them. Address, city, nationality, GSTIN and ID proof
// are no longer asked for anywhere; the columns stay in ex.party so the companies that filled
// them in keep what they had, and this form simply leaves them alone.
const Party = z.object({
  id: optId(),
  partyForm: z.enum(["INDIVIDUAL", "BUSINESS"]),
  fullName: z.string().trim().min(2, "Enter the name").max(160),
  phone: optText(20).refine((v) => v === null || /^[0-9+\- ]{8,20}$/.test(v), "Mobile: digits only"),
  email: optText(200).refine((v) => v === null || z.string().email().safeParse(v).success, "Enter a valid email"),
  notes: optText(500),
  active: checkbox,
});

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
      // every party buys and sells — there is nothing to choose at the counter
      isDepositor: true,
      isClient: true,
      phone: d.phone,
      email: d.email,
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
