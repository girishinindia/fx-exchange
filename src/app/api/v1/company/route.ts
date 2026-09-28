import { apiError, json, readJson, withApi } from "@/lib/api";
import { CompanyProfile, getCompany, saveCompanyProfile } from "@/server/services/admin";

export const dynamic = "force-dynamic";

/** GET /api/v1/company — the company profile and the rules the books run on (needs company.manage). */
export const GET = withApi(async (_req, s) => json({ company: await getCompany(s) }));

/**
 * PATCH /api/v1/company — the profile printed on documents. Code, currencies and the financial
 * year are not accepted here: they are fixed at setup, on the web, on purpose.
 */
export const PATCH = withApi(async (req, s) => {
  const body = await readJson<Record<string, unknown>>(req);
  const v = CompanyProfile.safeParse(body);
  if (!v.success) return apiError("invalid", v.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), 400);
  await saveCompanyProfile(s, v.data);
  return json({ company: await getCompany(s) });
});
