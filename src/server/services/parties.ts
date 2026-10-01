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
  // The screens always send both; the API still allows one on its own for the acceptance books.
  if (!d.isClient && !d.isDepositor) throw new Error("A party must be a depositor, a client, or both");
  return withTenant(await tenantOf(s), async (tx) => {
    if (d.id) {
      // The screens no longer ask for address, city, nationality, ID proof or GSTIN. A field
      // that is not sent at all keeps whatever the party already had — undefined leaves it as
      // it was, null clears it — so dropping them from the forms does not quietly erase what a
      // company typed in before.
      const [was] = await tx<Pick<PartyRow, "address" | "city" | "nationality" | "id_proof_type" | "id_proof_number" | "gstin">[]>`
        select address, city, nationality, id_proof_type, id_proof_number, gstin from ex.party where id = ${d.id}`;
      if (!was) throw new Error("Party not found");
      const keep = <T>(sent: T | undefined, had: T) => (sent === undefined ? had : sent);
      const [row] = await tx<{ id: string; party_code: string }[]>`
        update ex.party
           set full_name = ${d.fullName}, party_form = ${d.partyForm}, is_depositor = ${d.isDepositor}, is_client = ${d.isClient},
               phone = ${d.phone ?? null}, email = ${d.email ?? null},
               address     = ${keep(d.address, was.address)},
               city        = ${keep(d.city, was.city)},
               nationality = ${keep(d.nationality, was.nationality)},
               id_proof_type   = ${keep(d.idProofType, was.id_proof_type)},
               id_proof_number = ${keep(d.idProofNumber, was.id_proof_number)},
               gstin       = ${keep(d.gstin, was.gstin)},
               notes = ${d.notes ?? null}, is_active = ${d.isActive ?? true}
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

// ------------------------------------------------------------------ insight
// What the web party page shows beside the ledger, for the phone: balances per account
// (rupees owed, currency owed per currency), what a depositor is owed in currency, their
// money round the loop, and what they have earned the desk. Read-only, report.view.

export type PartyInsight = {
  receivable_inr: string;
  payable_inr: string;
  currency_due: Array<{ currency_code: string; fx_due: string; inr_value: string }>;
  owed_fx: Array<{ currency_code: string; fx_due: string; inr_value: string }>;
  cycle: {
    currency: string; status: string; deposit_count: number; deposited_fx: string; deposited_inr: string;
    dealt_fx: string; unspent_fx: string; deal_count: number; billed_inr: string; collected_inr: string;
    uncollected_inr: string; settled_fx: string; settled_inr: string; owed_fx: string; owed_inr: string; earned_inr: string;
  } | null;
  earned: {
    funded_deals: number; currency_dealt: string; cost_of_that: string; dealing_margin: string; rate_gain: string; total_earned: string;
  } | null;
};

export async function partyInsight(s: Session, id: number, isDepositor: boolean): Promise<PartyInsight> {
  await assertPermission("report.view", s);
  return withTenant(await tenantOf(s), async (tx) => {
    const balances = await tx<{ account_group: string; currency_code: string; balance_fx: string; balance_inr: string }[]>`
      select b.account_group, trim(b.currency_code) as currency_code, b.balance_fx::text, b.balance_inr::text
        from ex.v_party_balance b where b.party_id = ${id} and (b.balance_inr <> 0 or b.balance_fx <> 0)`;
    const receivable = balances.filter((b) => b.account_group === "RECEIVABLE").reduce((a, b) => a + Number(b.balance_inr), 0);
    const payable = balances.filter((b) => b.account_group === "PAYABLE").reduce((a, b) => a - Number(b.balance_inr), 0);
    const currency_due = balances
      .filter((b) => b.account_group === "CURRENCY_PAYABLE" && Number(b.balance_fx) !== 0)
      .map((b) => ({ currency_code: b.currency_code, fx_due: (-Number(b.balance_fx)).toFixed(4), inr_value: (-Number(b.balance_inr)).toFixed(2) }))
      .sort((a, b) => Number(b.inr_value) - Number(a.inr_value));
    if (!isDepositor) return { receivable_inr: receivable.toFixed(2), payable_inr: payable.toFixed(2), currency_due, owed_fx: [], cycle: null, earned: null };
    const owed_fx = await tx<{ currency_code: string; fx_due: string; inr_value: string }[]>`
      select trim(currency_code) as currency_code, fx_due::text, inr_value::text
        from ex.v_depositor_due where party_id = ${id} order by inr_value desc`;
    const [cycle] = await tx<NonNullable<PartyInsight["cycle"]>[]>`
      select trim(currency) as currency, status, deposit_count::int as deposit_count, deposited_fx::text, deposited_inr::text,
             dealt_fx::text, unspent_fx::text, deal_count::int as deal_count,
             billed_inr::text, collected_inr::text, uncollected_inr::text,
             settled_fx::text, settled_inr::text, owed_fx::text, owed_inr::text, earned_inr::text
        from ex.v_depositor_cycle where party_id = ${id}`;
    const [earned] = await tx<NonNullable<PartyInsight["earned"]>[]>`
      select funded_deals::int as funded_deals, currency_dealt::text, cost_of_that::text,
             dealing_margin::text, rate_gain::text, total_earned::text
        from ex.v_depositor_profit where party_id = ${id}`;
    return { receivable_inr: receivable.toFixed(2), payable_inr: payable.toFixed(2), currency_due, owed_fx, cycle: cycle ?? null, earned: earned ?? null };
  });
}
