import "server-only";
import { z } from "zod";

/**
 * Server-side environment. Parsed once, lazily, so `next build` works
 * without secrets; the first request that needs a value fails loudly if it is missing.
 * Nothing here is ever exposed to the browser (no NEXT_PUBLIC_ variables).
 */
const schema = z.object({
  // Supabase transaction pooler (port 6543) as role ex_app_login
  DATABASE_URL: z.string().url(),
  /**
   * The Super Admin console's own connection, as role ex_platform_login. Optional on purpose:
   * where it is not set the console does not exist, which is how the desk's own deployment is
   * meant to run. Deploy the console as its own project with this set and DATABASE_URL absent,
   * and neither half can do the other's job.
   */
  DATABASE_PLATFORM_URL: z.string().url().optional(),
  PLATFORM_COOKIE_NAME: z.string().default("fx_psid"),
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(10),
  SESSION_COOKIE_NAME: z.string().default("fx_sid"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  // Development only: show the portal shell without logging in (ignored in production)
  FX_PREVIEW: z.enum(["0", "1"]).default("0"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid or missing environment variables: ${missing}. See .env.example`);
  }
  cached = parsed.data;
  return cached;
}
