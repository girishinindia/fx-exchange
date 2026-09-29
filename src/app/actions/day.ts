"use server";

import { runAction, type ActionState } from "@/lib/action";
import { requireSession } from "@/lib/session";
import { dayClose } from "@/server/services/day";

/**
 * Day close: value the stock at the rates typed on the page. Nothing is posted and no rate is
 * kept — the answer comes back for this page only.
 */
export async function dayCloseAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const s = await requireSession();
    const date = String(fd.get("date") ?? "") || undefined;
    const rates: { currency: string; rate: string }[] = [];
    for (const [k, v] of fd.entries()) {
      if (k.startsWith("rate:") && typeof v === "string" && v.trim()) rates.push({ currency: k.slice(5), rate: v.trim() });
    }
    const out = await dayClose(s, { date, rates });
    return { ok: true, data: { json: JSON.stringify(out) } };
  });
}
