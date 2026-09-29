import "server-only";
import { cookies } from "next/headers";

/**
 * Simple or Full. Simple is the desk's five-word portal — Entry · Home · Money · People ·
 * Reports — with plain words and one screen for buying and selling. Full is the whole
 * portal, for the accountant. The choice is a cookie on this browser (a year), so the
 * CA's laptop stays Full and the counter's stays Simple, and no row in the database
 * changes for it. Simple is the default: it is the mode the desk asked for.
 */
export type UiMode = "simple" | "full";
export const UI_MODE_COOKIE = "fx_ui";

export async function getUiMode(): Promise<UiMode> {
  const jar = await cookies();
  return jar.get(UI_MODE_COOKIE)?.value === "full" ? "full" : "simple";
}
