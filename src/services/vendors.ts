import { z } from "zod";
import { withTx, query, one } from "@/lib/db";
import { type Actor, assertCan } from "@/lib/access";
import { vendorShortName } from "@/lib/naming";

export const VendorInput = z.object({
  name: z.string().trim().min(2),
  shortName: z.string().trim().regex(/^[A-Za-z0-9]+$/, "letters and digits only, no spaces").optional().or(z.literal("")),
  trades: z.array(z.string().trim().min(1)).default([]),
  statesServed: z.array(z.string().trim().toUpperCase().length(2)).default([]),
  contactName: z.string().trim().min(1),
  contactEmail: z.string().trim().email(),
  contactPhone: z.string().trim().optional(),
  yardiVendorId: z.string().trim().optional(),
});

export async function createVendor(actor: Actor, raw: unknown) {
  if (!actor.can("rfp.create") && !actor.can("contract.edit") && !actor.can("people.manage")) assertCan(actor, "rfp.create");
  const v = VendorInput.parse(raw);
  const short = v.shortName || vendorShortName(v.name);
  return withTx(actor.userId, async (c) => {
    // Duplicate detection (section 8.2): same short name, or a contact email on the same domain already on file.
    const domain = v.contactEmail.split("@")[1].toLowerCase();
    const dup = (await c.query(
      `select v.name from vendor v where lower(v.short_name) = lower($1)
       union select v.name from vendor v join vendor_contact vc on vc.vendor_id = v.id
        where split_part(lower(vc.email), '@', 2) = $2 and $2 not in ('gmail.com','yahoo.com','outlook.com','hotmail.com','icloud.com','aol.com')`,
      [short, domain],
    )).rows[0];
    if (dup) throw new Error(`Looks like a duplicate of “${dup.name}”. Open that vendor instead, or change the short name.`);
    const vendor = (await c.query(
      `insert into vendor (name, short_name, trades, states_served, yardi_vendor_id, approved_status, created_by, updated_by)
       values ($1,$2,$3,$4,$5,'pending',$6,$6) returning id`,
      [v.name, short, v.trades, v.statesServed, v.yardiVendorId || null, actor.userId],
    )).rows[0];
    await c.query(`insert into vendor_contact (vendor_id, name, email, phone, is_primary) values ($1,$2,$3,$4,true)`, [vendor.id, v.contactName, v.contactEmail, v.contactPhone || null]);
    return { id: vendor.id as string, shortName: short };
  });
}

const CoiInput = z.object({
  vendorId: z.string().uuid(),
  carrier: z.string().trim().optional(),
  glEachOccurrence: z.coerce.number().nonnegative().optional(),
  glAggregate: z.coerce.number().nonnegative().optional(),
  autoLimit: z.coerce.number().nonnegative().optional(),
  umbrellaLimit: z.coerce.number().nonnegative().optional(),
  additionalInsuredOk: z.coerce.boolean().optional(),
  effectiveOn: z.string().date().optional(),
  expiresOn: z.string().date(),
});

export async function addCoi(actor: Actor, raw: unknown) {
  const i = CoiInput.parse(raw);
  return withTx(actor.userId, (c) =>
    c.query(
      `insert into vendor_coi (vendor_id, carrier, gl_each_occurrence, gl_aggregate, auto_limit, umbrella_limit, additional_insured_ok, effective_on, expires_on)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [i.vendorId, i.carrier || null, i.glEachOccurrence ?? null, i.glAggregate ?? null, i.autoLimit ?? null, i.umbrellaLimit ?? null, i.additionalInsuredOk ?? null, i.effectiveOn ?? null, i.expiresOn],
    ),
  );
}

export async function addLicense(actor: Actor, raw: unknown) {
  const i = z.object({ vendorId: z.string().uuid(), state: z.string().toUpperCase().length(2), licenseNumber: z.string().min(1), expiresOn: z.string().date().optional() }).parse(raw);
  return withTx(actor.userId, (c) =>
    c.query(`insert into vendor_license (vendor_id, state, license_number, expires_on) values ($1,$2,$3,$4)`, [i.vendorId, i.state, i.licenseNumber, i.expiresOn ?? null]),
  );
}

export async function setVendorStatus(actor: Actor, vendorId: string, status: string) {
  const s = z.enum(["pending", "approved", "preferred", "probation", "do_not_use"]).parse(status);
  if (!actor.has("executive") && !actor.has("admin") && !actor.has("capex_pm") && !actor.has("contracts_admin")) throw new Error("Not allowed");
  await withTx(actor.userId, (c) => c.query(`update vendor set approved_status = $2, updated_at = now(), updated_by = $3 where id = $1`, [vendorId, s, actor.userId]));
}

export type Compliance = { ok: boolean; canInvite: boolean; issues: string[]; coiExpires: string | null };

/**
 * Compliance for awards and payments (section 8.2): current COI, license for the property's
 * state, W-9 on file, not do-not-use. Inviting to bid is allowed while paperwork is pending
 * (they register through the portal), but not for do-not-use vendors.
 */
export async function compliance(vendorId: string, state?: string, asOf = new Date().toISOString().slice(0, 10)): Promise<Compliance> {
  const v = await one<any>(`select approved_status, w9_doc_id from vendor where id = $1`, [vendorId]);
  if (!v) throw new Error("Vendor not found");
  const coi = await one<{ expires_on: string }>(`select expires_on from vendor_coi where vendor_id = $1 order by expires_on desc limit 1`, [vendorId]);
  const issues: string[] = [];
  if (v.approved_status === "do_not_use") issues.push("Marked do-not-use");
  if (!coi) issues.push("No certificate of insurance on file");
  else if (coi.expires_on < asOf) issues.push(`COI expired ${coi.expires_on}`);
  if (!v.w9_doc_id) issues.push("No W-9 on file");
  if (state) {
    const lic = await one<{ expires_on: string | null }>(`select expires_on from vendor_license where vendor_id = $1 and state = $2 order by expires_on desc nulls first limit 1`, [vendorId, state]);
    if (!lic) issues.push(`No ${state} license on file`);
    else if (lic.expires_on && lic.expires_on < asOf) issues.push(`${state} license expired ${lic.expires_on}`);
  }
  return { ok: issues.length === 0, canInvite: v.approved_status !== "do_not_use", issues, coiExpires: coi?.expires_on ?? null };
}

export async function listVendors(filter: { trade?: string; state?: string } = {}) {
  return query<any>(
    `select v.*, (select row_to_json(c) from vendor_contact c where c.vendor_id = v.id order by is_primary desc limit 1) contact,
            (select max(expires_on) from vendor_coi where vendor_id = v.id) coi_expires,
            (select count(*) from invitation i where i.vendor_id = v.id) invitations,
            (select count(*) from invitation i where i.vendor_id = v.id and i.submitted_at is not null) bids
       from vendor v
      where ($1::text is null or $1 = any(v.trades)) and ($2::text is null or $2 = any(v.states_served))
      order by (v.approved_status = 'preferred') desc, v.name`,
    [filter.trade ?? null, filter.state ?? null],
  );
}

export async function vendorCard(vendorId: string) {
  const [vendor, contacts, cois, licenses, history] = await Promise.all([
    one<any>(`select * from vendor where id = $1`, [vendorId]),
    query(`select * from vendor_contact where vendor_id = $1 order by is_primary desc, name`, [vendorId]),
    query(`select * from vendor_coi where vendor_id = $1 order by expires_on desc`, [vendorId]),
    query(`select * from vendor_license where vendor_id = $1 order by state`, [vendorId]),
    query(
      `select r.rfp_number, r.title, p.project_code, i.intent, i.submitted_at, i.sent_at
         from invitation i join rfp r on r.id = i.rfp_id join project p on p.id = r.project_id where i.vendor_id = $1 order by i.sent_at desc nulls last`,
      [vendorId],
    ),
  ]);
  return vendor ? { vendor, contacts, cois, licenses, history, compliance: await compliance(vendorId) } : null;
}
