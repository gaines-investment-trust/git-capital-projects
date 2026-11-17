import { z } from "zod";
import type { PoolClient } from "pg";
import { withTx, query, one } from "@/lib/db";
import { type Actor, assertCan } from "@/lib/access";
import { rfpNumber } from "@/lib/naming";
import { nextNumber } from "./projects";
import { requestApproval, onApproval } from "./approvals";
import { fileDocument } from "./filing";
import { compliance } from "./vendors";
import { newPortalToken, hashToken } from "@/lib/tokens";
import { sendMail, escapeHtml } from "@/lib/mail";
import { buildRfpDocx, buildBidFormXlsx } from "@/lib/rfpdoc";
import { env } from "@/lib/env";

export type Scope = { summary: string; items: string[]; inclusions: string; exclusions: string; phasing: string; residentImpact: string };
export type BidLine = { line_no: string; description: string; quantity: number | null; unit: string; kind: "base" | "alternate" | "allowance" | "unit_price" };

async function loadForEdit(c: PoolClient, actor: Actor, number: string) {
  const r = (await c.query(
    `select r.*, p.property_id, pr.region_id, p.manager_user_id, p.project_code, p.id project_id, p.budget_amount
       from rfp r join project p on p.id = r.project_id join property pr on pr.id = p.property_id where r.rfp_number = $1 for update of r`,
    [number],
  )).rows[0];
  if (!r) throw new Error("RFP not found");
  if (!actor.canAccessProperty(r.property_id, r.region_id)) throw new Error("You don't have access to this project");
  return r;
}

/** Step 1–2 of the wizard: number, template defaults and project facts (build prompt 8.1). */
export async function createRfp(actor: Actor, projectCode: string) {
  assertCan(actor, "rfp.create");
  return withTx(actor.userId, async (c) => {
    const p = (await c.query(
      `select p.*, pr.code pcode, pr.name pname, pr.region_id, t.default_bid_lines, t.name type_name
         from project p join property pr on pr.id = p.property_id join project_type t on t.id = p.project_type_id where p.project_code = $1`,
      [projectCode],
    )).rows[0];
    if (!p) throw new Error("Project not found");
    if (!actor.canAccessProperty(p.property_id, p.region_id)) throw new Error("You don't have access to this project");
    const n = await nextNumber(c, `rfp:${p.pcode}`);
    const number = rfpNumber(p.pcode, n);
    const req = (await c.query(`select value from app_setting where key = 'rfp.defaultRequirements'`)).rows[0]?.value ?? {};
    const scope: Scope = { summary: "", items: [], inclusions: "", exclusions: "", phasing: "", residentImpact: "" };
    const r = (await c.query(
      `insert into rfp (rfp_number, project_id, status, title, scope, requirements, created_by, updated_by)
       values ($1,$2,'draft',$3,$4,$5,$6,$6) returning id`,
      [number, p.id, `${p.pname} · ${p.name}`, scope, req, actor.userId],
    )).rows[0];
    let i = 0;
    for (const l of (p.default_bid_lines ?? []) as BidLine[]) {
      await c.query(`insert into bid_form_line (rfp_id, line_no, description, quantity, unit, kind, sort_order) values ($1,$2,$3,$4,$5,$6,$7)`, [
        r.id, l.line_no, l.description, l.quantity ?? null, l.unit, l.kind, i++,
      ]);
    }
    await c.query(`update project set stage_id = (select id from stage where code = 'rfp'), last_activity_at = now()
                    where id = $1 and (select sort_order from stage where id = project.stage_id) < (select sort_order from stage where code = 'rfp')`, [p.id]);
    return { id: r.id as string, number };
  });
}

const UpdateInput = z.object({
  title: z.string().trim().min(3).optional(),
  scope: z.object({
    summary: z.string(), items: z.array(z.string()), inclusions: z.string(), exclusions: z.string(), phasing: z.string(), residentImpact: z.string(),
  }).partial().optional(),
  requirements: z.record(z.string(), z.unknown()).optional(),
  siteWalkAt: z.string().nullable().optional(),
  questionsDueAt: z.string().nullable().optional(),
  bidDueAt: z.string().nullable().optional(),
  targetAwardDate: z.string().nullable().optional(),
  targetStartDate: z.string().nullable().optional(),
  coverNote: z.string().optional(),
});

/** Steps 3, 5 and 6: scope, requirements, key dates. Only while the RFP is a draft. */
export async function updateRfp(actor: Actor, number: string, raw: unknown) {
  assertCan(actor, "rfp.edit");
  const u = UpdateInput.parse(raw);
  return withTx(actor.userId, async (c) => {
    const r = await loadForEdit(c, actor, number);
    if (r.status !== "draft") throw new Error("Only a draft can be edited. Request changes on the approval to reopen it.");
    const scope = u.scope ? { ...r.scope, ...u.scope } : r.scope;
    const reqs = u.requirements ? { ...r.requirements, ...u.requirements } : r.requirements;
    const v = (k: keyof typeof u, cur: unknown) => (u[k] === undefined ? cur : u[k] || null);
    await c.query(
      `update rfp set title = $2, scope = $3, requirements = $4, site_walk_at = $5, questions_due_at = $6, bid_due_at = $7,
                      target_award_date = $8, target_start_date = $9, cover_note = $10, updated_at = now(), updated_by = $11 where id = $1`,
      [r.id, u.title ?? r.title, scope, reqs, v("siteWalkAt", r.site_walk_at), v("questionsDueAt", r.questions_due_at), v("bidDueAt", r.bid_due_at),
       v("targetAwardDate", r.target_award_date), v("targetStartDate", r.target_start_date), u.coverNote ?? r.cover_note, actor.userId],
    );
  });
}

const LineInput = z.object({
  line_no: z.string().trim().min(1).max(8),
  description: z.string().trim().min(2),
  quantity: z.coerce.number().positive().nullable().optional(),
  unit: z.string().trim().min(1).max(8),
  kind: z.enum(["base", "alternate", "allowance", "unit_price"]),
});

/** Step 4: the bid form. Every vendor prices the same lines. */
export async function saveBidForm(actor: Actor, number: string, rawLines: unknown) {
  assertCan(actor, "rfp.edit");
  const lines = z.array(LineInput).min(1, "Add at least one line").parse(rawLines);
  const dupes = lines.map((l) => l.line_no).filter((x, i, a) => a.indexOf(x) !== i);
  if (dupes.length) throw new Error(`Line numbers must be unique: ${[...new Set(dupes)].join(", ")}`);
  return withTx(actor.userId, async (c) => {
    const r = await loadForEdit(c, actor, number);
    if (r.status !== "draft") throw new Error("Only a draft can be edited");
    await c.query(`delete from bid_form_line where rfp_id = $1`, [r.id]);
    let i = 0;
    for (const l of lines) {
      await c.query(`insert into bid_form_line (rfp_id, line_no, description, quantity, unit, kind, sort_order) values ($1,$2,$3,$4,$5,$6,$7)`, [
        r.id, l.line_no, l.description, l.quantity ?? null, l.unit, l.kind, i++,
      ]);
    }
  });
}

export type Check = { level: "blocker" | "warning"; message: string };

/**
 * Step 7 package check. These are the rule-based checks that must pass; Claude's reading of the
 * scope for gaps and inconsistencies is added on top once the API key is configured.
 */
export function checkPackage(r: any, lines: BidLine[]): Check[] {
  const out: Check[] = [];
  const s: Scope = r.scope ?? {};
  if (!s.summary || s.summary.trim().length < 40) out.push({ level: "blocker", message: "Scope summary is missing or too short (40+ characters)" });
  if (!s.items?.filter(Boolean).length) out.push({ level: "blocker", message: "Add at least one numbered scope item" });
  const base = lines.filter((l) => l.kind === "base");
  if (!base.length) out.push({ level: "blocker", message: "The bid form needs at least one base line" });
  const noQty = base.filter((l) => !l.quantity && l.unit !== "LS");
  if (noQty.length) out.push({ level: "warning", message: `No quantity on line${noQty.length > 1 ? "s" : ""} ${noQty.map((l) => l.line_no).join(", ")}: vendors will price their own take-off` });
  if (!r.bid_due_at) out.push({ level: "blocker", message: "Set the bid due date and time" });
  if (r.bid_due_at && new Date(r.bid_due_at) < new Date()) out.push({ level: "blocker", message: "Bid due date is in the past" });
  if (r.questions_due_at && r.bid_due_at && new Date(r.questions_due_at) >= new Date(r.bid_due_at)) out.push({ level: "blocker", message: "Questions must be due before bids" });
  if (r.site_walk_at && r.questions_due_at && new Date(r.site_walk_at) >= new Date(r.questions_due_at)) out.push({ level: "warning", message: "Site walk is after the questions deadline" });
  if (r.questions_due_at && r.bid_due_at) {
    const days = (new Date(r.bid_due_at).getTime() - new Date(r.questions_due_at).getTime()) / 86400000;
    if (days < 3) out.push({ level: "warning", message: "Less than 3 days between the questions deadline and bids due: little time to answer and issue an addendum" });
  }
  if (!r.requirements?.gl_each_occurrence) out.push({ level: "blocker", message: "Insurance minimums are missing" });
  return out;
}

/** Submit for approval: the PM's step counts as submission; COO next (section 6.1 "RFP to bid"). */
export async function submitRfp(actor: Actor, number: string) {
  assertCan(actor, "rfp.edit");
  return withTx(actor.userId, async (c) => {
    const r = await loadForEdit(c, actor, number);
    if (r.status !== "draft") throw new Error(`This RFP is ${r.status.replace("_", " ")}`);
    const lines = (await c.query(`select * from bid_form_line where rfp_id = $1 order by sort_order`, [r.id])).rows;
    const blockers = checkPackage(r, lines).filter((x) => x.level === "blocker");
    if (blockers.length) throw new Error(`Fix before submitting: ${blockers.map((b) => b.message).join("; ")}`);
    await c.query(`update rfp set status = 'in_review', updated_at = now() where id = $1`, [r.id]);
    const chain = await requestApproval(c, {
      objectType: "rfp", objectId: r.id, amount: Number(r.budget_amount ?? 0), projectId: r.project_id, pmId: r.manager_user_id,
      requestedBy: actor.userId, summary: `${number} · ${r.title} · ${lines.length} bid lines · bids due ${new Date(r.bid_due_at).toLocaleDateString("en-US")}`,
    });
    // If every step was the submitter's own (e.g. an executive PM), it is already approved.
    const open = (await c.query(`select count(*)::int n from approval where object_type = 'rfp' and object_id = $1 and decision is null`, [r.id])).rows[0].n;
    if (open === 0) await c.query(`update rfp set status = 'approved' where id = $1`, [r.id]);
    return { approvers: chain.map((s) => s.name), status: open === 0 ? "approved" : "in_review" };
  });
}

onApproval("rfp", {
  approved: async (c, id) => { await c.query(`update rfp set status = 'approved', updated_at = now() where id = $1`, [id]); },
  returned: async (c, id) => { await c.query(`update rfp set status = 'draft', updated_at = now() where id = $1`, [id]); },
});

/** Step 8: generate the RFP (DOCX) and bid form (XLSX), file both in 02 RFP\Issued, mark issued. */
export async function issueRfp(actor: Actor, number: string) {
  assertCan(actor, "rfp.edit");
  const data = await rfpDetail(actor, number);
  if (!data) throw new Error("RFP not found");
  const { rfp, lines, project } = data;
  if (rfp.status !== "approved") throw new Error("The RFP must be approved before it is issued");
  const today = new Date().toISOString().slice(0, 10);
  const docx = await buildRfpDocx({ rfp, lines, project });
  const xlsx = await buildBidFormXlsx({ rfp, lines, project });
  const a = await fileDocument(actor, { originalName: `${number}.docx`, content: docx, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", source: "generated" },
    { projectCode: project.project_code, docType: "RFP", party: "GIT", docDate: today, confidence: 1 });
  const b = await fileDocument(actor, { originalName: `${number} bid form.xlsx`, content: xlsx, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", source: "generated" },
    { projectCode: project.project_code, docType: "BidForm", party: "GIT", docDate: today, confidence: 1 });
  await withTx(actor.userId, async (c) => {
    await c.query(`update rfp set status = 'issued', issue_date = current_date, rfp_document_id = $2, bid_form_document_id = $3, docx_document_id = $2, updated_at = now() where id = $1`,
      [rfp.id, a.documentId, b.documentId]);
    await c.query(`update project set stage_id = (select id from stage where code = 'bidding'), last_activity_at = now() where id = $1`, [project.id]);
  });
  return { rfpFile: a, bidFormFile: b };
}

/**
 * Section 8.3: email each vendor from the manager's own Outlook with the RFP attached and a
 * personal portal link. Links are single-vendor, stored hashed, and expire 14 days after bids are due.
 */
export async function inviteVendors(actor: Actor, number: string, vendorIds: string[], delegatedToken: string | null) {
  assertCan(actor, "rfp.edit");
  const data = await rfpDetail(actor, number);
  if (!data) throw new Error("RFP not found");
  const { rfp, project } = data;
  if (rfp.status !== "issued") throw new Error("Issue the RFP before inviting vendors");
  const doc = rfp.docx_document_id ? await one<any>(`select * from document where id = $1`, [rfp.docx_document_id]) : null;
  const attachment = doc ? await readStored(doc) : null;
  const results: { vendor: string; status: string; link?: string; issues: string[] }[] = [];
  for (const vendorId of vendorIds) {
    const v = await one<any>(`select v.*, c.id contact_id, c.name contact_name, c.email contact_email from vendor v
                               left join lateral (select * from vendor_contact where vendor_id = v.id order by is_primary desc limit 1) c on true where v.id = $1`, [vendorId]);
    if (!v) continue;
    const comp = await compliance(vendorId, project.state);
    if (!comp.canInvite) { results.push({ vendor: v.name, status: "skipped: do-not-use", issues: comp.issues }); continue; }
    if (!v.contact_email) { results.push({ vendor: v.name, status: "skipped: no contact email", issues: comp.issues }); continue; }
    const existing = await one<any>(`select id from invitation where rfp_id = $1 and vendor_id = $2`, [rfp.id, vendorId]);
    if (existing) { results.push({ vendor: v.name, status: "already invited", issues: comp.issues }); continue; }
    const { token, hash } = newPortalToken();
    const expires = new Date(new Date(rfp.bid_due_at).getTime() + 14 * 86400000);
    const link = `${env().APP_BASE_URL}/portal/${token}`;
    await withTx(actor.userId, (c) =>
      c.query(`insert into invitation (rfp_id, vendor_id, contact_id, sent_by, sent_at, magic_link_hash, magic_link_expires_at) values ($1,$2,$3,$4, now(), $5, $6)`,
        [rfp.id, vendorId, v.contact_id, actor.userId, hash, expires]),
    );
    const due = new Date(rfp.bid_due_at).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short", timeZone: "America/Los_Angeles" });
    const html =
      `<p>${escapeHtml(v.contact_name ?? v.name)},</p>` +
      `<p>Gaines Investment Trust invites ${escapeHtml(v.name)} to bid on <b>${escapeHtml(rfp.title)}</b> (${number}).</p>` +
      (rfp.cover_note ? `<p>${escapeHtml(rfp.cover_note)}</p>` : "") +
      `<p><b>Bids are due ${escapeHtml(due)} (Pacific).</b>` +
      (rfp.site_walk_at ? ` Site walk: ${escapeHtml(new Date(rfp.site_walk_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles" }))}.` : "") + `</p>` +
      `<p>The RFP is attached. Use your personal link to confirm whether you will bid, ask questions, see answers and addenda, and submit your bid:<br><a href="${link}">${link}</a></p>` +
      `<p>Please don't forward this link; it is unique to ${escapeHtml(v.name)}.</p><p>${escapeHtml(actor.displayName)}<br>Gaines Investment Trust</p>`;
    const sent = await sendMail({
      fromUserId: actor.userId, fromAddress: actor.email, to: [v.contact_email],
      subject: `${number} · Invitation to bid · ${rfp.title} · due ${new Date(rfp.bid_due_at).toLocaleDateString("en-US")}`,
      html, attachments: attachment ? [{ name: doc.file_name, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", content: attachment }] : [],
      projectId: project.id, rfpId: rfp.id, vendorId,
    }, delegatedToken);
    results.push({ vendor: v.name, status: sent.mode === "graph" ? "sent" : "sent to local outbox", link: env().DOCSTORE === "local" ? link : undefined, issues: comp.issues });
  }
  return results;
}

async function readStored(doc: any): Promise<Buffer | null> {
  if (doc.sp_drive_id !== "local") return null; // Graph download is added with the Graph content endpoint in the deploy sprint
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  return readFile(join(env().LOCAL_DOCSTORE_DIR, doc.sp_path)).catch(() => null);
}

export async function rfpDetail(actor: Actor, number: string) {
  const rfp = await one<any>(`select * from rfp where rfp_number = $1`, [number]);
  if (!rfp) return null;
  const project = await one<any>(
    `select p.*, pr.code pcode, pr.name pname, pr.state, pr.city, pr.address_line1, pr.units, pr.region_id, u.display_name manager, u.email manager_email
       from project p join property pr on pr.id = p.property_id join app_user u on u.id = p.manager_user_id where p.id = $1`,
    [rfp.project_id],
  );
  if (!actor.canAccessProperty(project.property_id, project.region_id)) return null;
  const [lines, invitations, questions] = await Promise.all([
    query<any>(`select * from bid_form_line where rfp_id = $1 order by sort_order`, [rfp.id]),
    query<any>(
      `select i.*, v.name vendor_name, v.short_name, (select max(version) from bid b where b.invitation_id = i.id) bid_version,
              (select total_base from bid b where b.invitation_id = i.id order by version desc limit 1) bid_total
         from invitation i join vendor v on v.id = i.vendor_id where i.rfp_id = $1 order by v.name`,
      [rfp.id],
    ),
    query<any>(`select q.*, v.name vendor_name from rfp_question q left join invitation i on i.id = q.invitation_id left join vendor v on v.id = i.vendor_id where q.rfp_id = $1 order by q.id`, [rfp.id]),
  ]);
  return { rfp, project, lines, invitations, questions, checks: checkPackage(rfp, lines) };
}

export async function rfpsForProject(projectId: string) {
  return query<any>(`select r.*, (select count(*) from invitation i where i.rfp_id = r.id) invited,
                            (select count(*) from invitation i where i.rfp_id = r.id and i.submitted_at is not null) submitted
                       from rfp r where project_id = $1 order by r.created_at`, [projectId]);
}

export async function answerQuestion(actor: Actor, questionId: string, answer: string) {
  assertCan(actor, "rfp.edit");
  const a = z.string().trim().min(2).parse(answer);
  await withTx(actor.userId, (c) => c.query(`update rfp_question set answer = $2, answered_by = $3, published_at = now() where id = $1`, [questionId, a, actor.userId]));
}

/* ----------------------------- Vendor portal (no staff sign-in) ----------------------------- */

async function invitationByToken(c: PoolClient | null, token: string) {
  const sql = `select i.*, v.name vendor_name, r.rfp_number, r.status rfp_status, r.bid_due_at, r.id rfp_id
                 from invitation i join vendor v on v.id = i.vendor_id join rfp r on r.id = i.rfp_id where i.magic_link_hash = $1`;
  const row = c ? (await c.query(sql, [hashToken(token)])).rows[0] : await one<any>(sql, [hashToken(token)]);
  if (!row) throw new PortalError("This link isn't valid. Ask Gaines Investment Trust to resend your invitation.");
  if (row.magic_link_expires_at && new Date(row.magic_link_expires_at) < new Date()) throw new PortalError("This link has expired.");
  return row;
}

export class PortalError extends Error {}

export async function portalView(token: string) {
  const inv = await invitationByToken(null, token);
  await withTx(null, (c) => c.query(`update invitation set opened_at = coalesce(opened_at, now()), last_viewed_at = now() where id = $1`, [inv.id]));
  const rfp = await one<any>(`select r.*, p.name project_name, pr.name property_name, pr.state, pr.city from rfp r join project p on p.id = r.project_id join property pr on pr.id = p.property_id where r.id = $1`, [inv.rfp_id]);
  const [lines, questions, bid] = await Promise.all([
    query<any>(`select * from bid_form_line where rfp_id = $1 order by sort_order`, [inv.rfp_id]),
    query<any>(`select question, answer, published_at from rfp_question where rfp_id = $1 and (published_at is not null or invitation_id = $2) order by id`, [inv.rfp_id, inv.id]),
    one<any>(`select * from bid where invitation_id = $1 order by version desc limit 1`, [inv.id]),
  ]);
  const bidLines = bid ? await query<any>(`select * from bid_line where bid_id = $1`, [bid.id]) : [];
  return { invitation: inv, rfp, lines, questions, bid, bidLines, closed: new Date(inv.bid_due_at) < new Date() };
}

export async function portalSetIntent(token: string, intent: "will_bid" | "declined", reason?: string) {
  return withTx(null, async (c) => {
    const inv = await invitationByToken(c, token);
    if (intent === "declined" && !reason?.trim()) throw new PortalError("Please tell us why you're declining");
    await c.query(`update invitation set intent = $2, decline_reason = $3 where id = $1`, [inv.id, intent, intent === "declined" ? reason : null]);
  });
}

export async function portalAsk(token: string, question: string) {
  const q = z.string().trim().min(5, "Question is too short").max(2000).parse(question);
  return withTx(null, async (c) => {
    const inv = await invitationByToken(c, token);
    const r = (await c.query(`select questions_due_at from rfp where id = $1`, [inv.rfp_id])).rows[0];
    if (r.questions_due_at && new Date(r.questions_due_at) < new Date()) throw new PortalError("The deadline for questions has passed");
    await c.query(`insert into rfp_question (rfp_id, invitation_id, question) values ($1,$2,$3)`, [inv.rfp_id, inv.id, q]);
  });
}

const BidSubmission = z.object({
  lines: z.array(z.object({ lineId: z.string().uuid(), unitPrice: z.coerce.number().nonnegative().nullable(), amount: z.coerce.number().nonnegative().nullable(), included: z.boolean() })),
  exclusions: z.string().optional(),
  scheduleDays: z.coerce.number().int().positive().nullable().optional(),
  warrantyYears: z.coerce.number().nonnegative().nullable().optional(),
});

/** Electronic bid form (8.3). Each submission is a new version; late bids are flagged for the PM to accept. */
export async function portalSubmitBid(token: string, raw: unknown) {
  const b = BidSubmission.parse(raw);
  return withTx(null, async (c) => {
    const inv = await invitationByToken(c, token);
    if (!["issued", "closed"].includes(inv.rfp_status)) throw new PortalError("This RFP isn't accepting bids");
    const form = (await c.query(`select * from bid_form_line where rfp_id = $1`, [inv.rfp_id])).rows;
    const byId = new Map(form.map((l: any) => [l.id, l]));
    let total = 0;
    const priced: { line: any; unitPrice: number | null; amount: number | null; included: boolean }[] = [];
    for (const l of b.lines) {
      const line = byId.get(l.lineId);
      if (!line) throw new PortalError("Bid form has changed; reload the page");
      const qty = line.quantity === null ? null : Number(line.quantity);
      const amount = !l.included ? null : l.amount ?? (l.unitPrice !== null && qty !== null ? Math.round(l.unitPrice * qty * 100) / 100 : null);
      if (line.kind === "base" && l.included && amount === null) throw new PortalError(`Price line ${line.line_no}, or mark it excluded`);
      if (line.kind === "base" && amount !== null) total += amount;
      priced.push({ line, unitPrice: l.unitPrice, amount, included: l.included });
    }
    const missing = form.filter((l: any) => l.kind === "base" && !b.lines.some((x) => x.lineId === l.id));
    if (missing.length) throw new PortalError(`Missing line${missing.length > 1 ? "s" : ""} ${missing.map((l: any) => l.line_no).join(", ")}`);
    const version = (((await c.query(`select max(version) v from bid where invitation_id = $1`, [inv.id])).rows[0].v as number) ?? 0) + 1;
    const late = new Date() > new Date(inv.bid_due_at);
    const bid = (await c.query(
      `insert into bid (invitation_id, version, source, total_base, schedule_days, warranty_years, exclusions) values ($1,$2,'portal',$3,$4,$5,$6) returning id`,
      [inv.id, version, total, b.scheduleDays ?? null, b.warrantyYears ?? null, b.exclusions ? [b.exclusions] : []],
    )).rows[0];
    for (const p of priced) {
      await c.query(`insert into bid_line (bid_id, bid_form_line_id, unit_price, amount, included) values ($1,$2,$3,$4,$5)`, [bid.id, p.line.id, p.unitPrice, p.amount, p.included]);
    }
    await c.query(`update invitation set submitted_at = now(), intent = 'will_bid', is_late = is_late or $2 where id = $1`, [inv.id, late]);
    return { version, totalBase: total, late };
  });
}
