"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { UI_MODE_COOKIE } from "@/lib/ui-mode";

/** Switch this browser between the Simple portal and the Full one. */
export async function setUiModeAction(fd: FormData): Promise<void> {
  const mode = fd.get("mode") === "full" ? "full" : "simple";
  const jar = await cookies();
  jar.set(UI_MODE_COOKIE, mode, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
  const to = typeof fd.get("to") === "string" && String(fd.get("to")).startsWith("/") ? String(fd.get("to")) : mode === "full" ? "/dashboard" : "/entry";
  redirect(to);
}
