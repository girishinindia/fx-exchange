/**
 * What counts as the same login.
 *
 * A person signs in with their email address or their mobile number — there is no company
 * code any more, so whatever they type has to identify one human being on the whole
 * installation. This is the rule for deciding when two spellings are the same person, and it
 * is the exact twin of `ex.fn_login_key(text)` in migration 0014. The database is what
 * actually enforces uniqueness; this copy exists so rate-limit keys and messages agree with
 * it, and the two must be changed together.
 *
 *   " Girish@Example.COM "  → girish@example.com
 *   "+91 96622 78990"       → 9662278990
 *   "09662278990"           → 9662278990
 */
export function loginKey(input: string): string {
  const raw = (input ?? "").trim();
  if (raw === "") return "";
  if (raw.includes("@")) return raw.toLowerCase();
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  if (digits !== "") return digits;
  return raw.toLowerCase();
}

/** True when what was typed looks like an email address rather than a telephone number. */
export function looksLikeEmail(input: string): boolean {
  return (input ?? "").includes("@");
}

/**
 * Is this usable as a login at all? Deliberately loose: the sign-in screen should not argue
 * with somebody about the shape of their own address, it should tell them it did not match.
 * A real address or a real number is checked when a Super Admin creates the account.
 */
export function isPlausibleLogin(input: string): boolean {
  const raw = (input ?? "").trim();
  if (raw.length < 3 || raw.length > 200) return false;
  if (looksLikeEmail(raw)) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
  return raw.replace(/\D/g, "").length >= 10;
}
