import "server-only";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { PermissionError } from "@/lib/permissions";

/** Standard result of every form server action. */
export type ActionState = { error?: string; ok?: boolean; message?: string; fieldErrors?: Record<string, string>; data?: Record<string, string> };

export class RuleError extends Error {}

/** Map any thrown error to a friendly message (Next.js redirects/notFound are re-thrown). */
export function actionError(e: unknown): ActionState {
  unstable_rethrow(e);
  if (e instanceof PermissionError || e instanceof RuleError) return { error: e.message };
  if (e instanceof z.ZodError) return { error: e.issues[0]?.message ?? "Please check the form." };
  if (typeof e === "object" && e && "code" in e) {
    const pg = e as { code: string; message?: string; constraint_name?: string };
    if (pg.code === "23505") return { error: "This already exists (duplicate)." };
    if (pg.code === "23514") return { error: "A value is not allowed. Please check the numbers." };
    if (pg.code === "23503") return { error: "A linked record was not found." };
    if (pg.code === "P0001" || pg.code === "42501") return { error: pg.message ?? "Not allowed." };
  }
  console.error(e);
  return { error: "Could not save. Please try again." };
}

export async function runAction(fn: () => Promise<ActionState>): Promise<ActionState> {
  try {
    return await fn();
  } catch (e) {
    return actionError(e);
  }
}

/** zod issues → { field: message } */
export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) out[String(i.path[0] ?? "_")] ??= i.message;
  return out;
}

// ------------------------------------------------------------------ common field schemas
/**
 * An optional id coming from a <select>: an unchosen option submits "" (not "undefined"),
 * which `z.coerce.number()` would turn into 0 and reject. Blank means "not given".
 */
export const optId = (opts: { min?: number } = {}) =>
  z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    z.coerce.number().int().min(opts.min ?? 1).optional(),
  );

export const optText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

/** Positive decimal as a string (never parsed to float). */
export const decimalStr = (label: string, maxDp = 6) =>
  z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{1,12}(\\.\\d{1,${maxDp}})?$`), `${label}: enter a number (max ${maxDp} decimals)`)
    .refine((v) => Number(v) > 0, `${label} must be greater than 0`);

export const optDecimalStr = (label: string, maxDp = 6) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || new RegExp(`^\\d{1,12}(\\.\\d{1,${maxDp}})?$`).test(v), `${label}: enter a number`);

/** HTML checkbox: "on" / "true" / "1" → true; missing or anything else → false. */
export const checkbox = z
  .any()
  .optional()
  .transform((v) => v === "on" || v === "true" || v === "1");
