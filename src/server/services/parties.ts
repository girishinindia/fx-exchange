import "server-only";
import { withTenant } from "@/lib/db";
import { assertPermission } from "@/lib/permissions";
import { tenantOf, type Session } from "@/lib/session";

/** Depositors and clients. A firm can be both; the ledger keeps their two balances apart. */

export type PartyRow = {
  id: string; party_code: string; full_name: string; party_form: string; is_depositor: boolean; is_client: boolean;
  phone: string | null; email: string | null; city: string | null; gstin: string | null; is_active: boolean;
  id_proof_type: string | null; id_proof_number: string | null; address: string | null; nationality: string | null; notes: string | null;
  receivable_inr: string; payable_inr: string;
};

export type PartyInput = {
  id?: number;
  partyCode?: string | null;
  fullName: string;
  partyForm: "INDIVIDUAL" | "BUSINESS";
  isDepositor: boolean;
  isClient: boolean;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  nationality?: string | null;
  idProofType?: string | null;
  idProofNumber?: string | null;
  gstin?: string | null;
  notes?: string | null;
  isActive?: boolean;
};

export type PartyFilter = { kind?: "CLIENT" | "DEPOSITOR" | null; q?: string | null; active?: boolean | null; limit?: number; offset?: number };

export async function listParties(s: Session, f: PartyFilter = {}): Promise<{ rows: PartyRow[]; total: number }> {
  await assertPermission("party.view", s);
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const offset = Math.max(f.offset ?? 0, 0);
  const like = f.q ? `%${f.q}%` : null;
  const digits = f.q ? f.q.replace(/\D/g, "") : "";
  const phoneLike = digits.length >= 4 ? `%${digits}%` : null;
  return withTenant(await tenantOf(s), async (tx) => {
    const where = tx`
      (${f.kind ?? null}::text is null or (${f.kind ?? null} = 'CLIENT' and p.is_client) or (${f.kind ?? null} = 'DEPOSITOR' and p.is_depositor))
      and (${f.active ?? null}::boolean is null or p.is_active = ${f.active ?? null})
      and (${like}::text is null or p.full_name ilike ${like} or p.party_code ilike ${like} or p.gstin ilike ${like}
           or (${phoneLike}::text is not null and regexp_replace(coalesce(p.phone, ''), '\\D', '', 'g') like ${phoneLike}))`;
    const rows = await tx<PartyRow[]>`
      select p.id, p.party_code, p.full_name, p.party_form, p.is_depositor, p.is_client, p.phone, p.email, p.city,
             p.gstin, p.is_active, p.id_proof_type, p.id_proof_number, p.address, p.nationality, p.notes,
             coalesce((select sum(b.balance_inr) from ex.v_party_balance b
                        where b.party_id = p.id and b.account_group = 'RECEIVABLE'), 0)::text as receivable_inr,
             coalesce((select -sum(b.balance_inr) from ex.v_party_balance b
                        where b.party_id = p.id and b.account_group in ('PAYABLE','CURRENCY_PAYABLE')), 0)::text as payable_inr
        from ex.party p
       where ${where}
       order by p.is_active desc, p.full_name
       limit ${limit} offset ${offset}`;
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from ex.party p where ${where}`;
    return { rows, total: n };
  });
}

export async function getParty(s: Session, id: number): Promise<PartyRow | null> {
  await assertPermission("party.view", s);
  return withTenant(await tenantOf(s), async (tx) => {
    const [row] = await tx<PartyRow[]>`
      select p.id, p.party_code, p.full_name, p.party_form, p.is_depositor, p.is_client, p.phone, p.email, p.city,
             p.gstin, p.is_active, p.id_proof_type, p.id_proof_number, p.address, p.nationality, p.notes,
             coalesce((select sum(b.balance_inr) from ex.v_party_balance b
                        where b.party_id = p.id and b.account_group = 'RECEIVABLE'), 0)::text as receivable_inr,
             coalesce((select -sum(b.balance_inr) from ex.v_party_balance b
                        where b.party_id = p.id and b.account_group in ('PAYABLE','CURRENCY_PAYABLE')), 0)::text as payable_inr
        from ex.party p where p.id = ${id}`;
    return row ?? null;
  });
}

/** Create or update. The code is generated (P-00001) when not given. */
export async function saveParty(s: Session, d: PartyInput): Promise<{ id: string; partyCode: string }> {
  await assertPermission("party.manage", s);
  if (!d.isClient && !d.isDepositor) throw new Error("Tick depositor, client, or both");
  return withTenant(await tenantOf(s), async (tx) => {
    if (d.id) {
      const [row] = await tx<{ id: string; party_code: string }[]>`
        update ex.party
           set full_name = ${d.fullName}, party_form = ${d.partyForm}, is_depositor = ${d.isDepositor}, is_client = ${d.isClient},
               phone = ${d.phone ?? null}, email = ${d.email ?? null}, address = ${d.address ?? null}, city = ${d.city ?? null},
               nationality = ${d.nationality ?? null}, id_proof_type = ${d.idProofType ?? null}, id_proof_number = ${d.idProofNumber ?? null},
               gstin = ${d.gstin ?? null}, notes = ${d.notes ?? null}, is_active = ${d.isActive ?? true}
         where id = ${d.id}
         returning id, party_code`;
      if (!row) throw new Error("Party not found");
      return { id: String(row.id), partyCode: row.party_code };
    }
    const [{ code }] = await tx<{ code: string }[]>`
      select 'P-' || lpad((coalesce(max(nullif(regexp_replace(party_code, '\\D', '', 'g'), ''))::bigint, 0) + 1)::text, 5, '0') as code
        from ex.party`;
    const [row] = await tx<{ id: string; party_code: string }[]>`
      insert into ex.party (party_code, full_name, party_form, is_depositor, is_client, phone, email, address, city,
                            nationality, id_proof_type, id_proof_number, gstin, notes, is_active)
      values (${d.partyCode || code}, ${d.fullName}, ${d.partyForm}, ${d.isDepositor}, ${d.isClient}, ${d.phone ?? null},
              ${d.email ?? null}, ${d.address ?? null}, ${d.city ?? null}, ${d.nationality ?? null}, ${d.idProofType ?? null},
              ${d.idProofNumber ?? null}, ${d.gstin ?? null}, ${d.notes ?? null}, ${d.isActive ?? true})
      returning id, party_code`;
    return { id: String(row.id), partyCode: row.party_code };
  });
}
