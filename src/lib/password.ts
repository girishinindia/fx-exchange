import "server-only";
import { randomInt } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";

/** argon2id (the library default) with OWASP-recommended cost. */
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTS);
}

export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  try {
    return await verify(stored, plain);
  } catch {
    return false; // malformed hash → treat as wrong password
  }
}

/** Used when the user does not exist, so a wrong email takes as long as a wrong password. */
const DUMMY_HASH = "$argon2id$v=19$m=19456,t=2,p=1$1YyjHu3PNf1V8Y7CpkP/pg$keewoHiAlVNC2nQ2xwajTzuT1rHlnjeU/ZKy4MSeTas";
export async function burnVerifyTime(plain: string): Promise<void> {
  await verifyPassword(DUMMY_HASH, plain);
}

export const passwordPolicy = z
  .string()
  .min(10, "At least 10 characters")
  .max(128, "At most 128 characters")
  .regex(/[A-Za-z]/, "Must contain a letter")
  .regex(/[0-9]/, "Must contain a number");

/** Readable temporary password, e.g. "Fx-7kq3-M9tw-2026" (no look-alike characters). */
export function temporaryPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const block = () => Array.from({ length: 4 }, () => chars[randomInt(chars.length)]).join("");
  return `Fx-${block()}-${block()}-${randomInt(10, 99)}`;
}
