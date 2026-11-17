import type { PoolClient } from "pg";
import { pacificDate } from "@/lib/time";
import { withTx, query, one } from "@/lib/db";
import { type Actor, assertCan } from "@/lib/access";
import { contractNumber } from "@/lib/naming";
import { escapeHtml, sendMail } from "@/lib/mail";
import { buildContractDocx } from "@/lib/contractdoc";
import { docusignEnabled, sendContractEnvelope, downloadCompleted, voidEnvelope } from "@/lib/docusign";
import { loadActor } from "@/lib/access";
import { level, AwardInput } from "./leveling";
import { nextNumber } from "./projects";
import { requestApproval, onApproval } from "./approvals";
import { compliance } from "./vendors";
import { fileDocument } from "./filing";
import { saveBaseline } from "./schedule";

/**
 * Award (8.4): the PM picks the bid and alternates and writes the memo. Awards always go
 * PM → COO → President (section 6.1). The winner's paperwork must be complete before it goes.
 */
export async function requestAward(actor: Actor, rfpNumber: string, raw: unknown) {
  assertCan(actor, "rfp.edit");
  const a = AwardInput.parse(raw);
  const lv = await level(actor, rfpNumber, { alternates: a.alternates });
  if (!["issued", "closed"].includes(lv.rfp.status)) throw new Error(`An award needs bids in hand (RFP is ${lv.rfp.status})`);
  const win = lv.bidders.find((b) => b.invitationId === a.invitationId);
  if (!win) throw new Error("That vendor has no bid on this RFP");
  if (!win.compliant) throw new Error(`Award blocked until ${win.vendor}'s paperwork is complete: ${win.complianceIssues.join("; ")}`);
  const excluded = lv.lines.filter((l: any) => l.kind === "base" && win.cells[l.id].amount === null);
  if (excluded.length) throw new Error(`${win.vendor} did not price line${excluded.length > 1 ? "s" : ""} ${excluded.map((l: any) => l.line_no).join(", ")}. Get a revised bid or a written clarification before awarding.`);

  return withTx(actor.userId, async (c) => {
    const exists = (await c.query(`select id, status from award where rfp_id = $1`, [lv.rfp.id])).rows[0];
    if (exists && exists.status !== "returned") throw new Error(`An award is already ${exists.status.replace("_", " ")}`);
    if (exists) await c.query(`delete from award where id = $1`, [exists.id]);
    const alts = lv.lines.filter((l: any) => a.alternates.includes(l.id)).map((l: any) => l.line_no);
    const award = (await c.query(
      `insert into award (rfp_id, bid_id, memo, alternates_accepted, leveled_total, contract_value, status, created_by)
       values ($1,$2,$3,$4,$5,$6,'pending_approval',$7) returning id`,
      [lv.rfp.id, win.bidId, a.memo, alts, win.leveledTotal, win.contractValue, actor.userId],
    )).rows[0];
    // Record the plugs used for the comparison (shown separately, never contract value)
    for (const b of lv.bidders) for (const l of lv.lines) {
      const cell = b.cells[l.id];
      if (cell.plug !== null) await c.query(`insert into bid_normalization (bid_id, bid_form_line_id, amount, reason, created_by) values ($1,$2,$3,'Median of other bids for a line this bid excluded',$4)`, [b.bidId, l.id, cell.plug, actor.userId]);
    }
    const p = (await c.query(`select manager_user_id from project where id = $1`, [lv.rfp.project_id])).rows[0];
    const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    await requestApproval(c, {
      objectType: "award", objectId: award.id, amount: win.contractValue, projectId: lv.rfp.project_id, pmId: p.manager_user_id, requestedBy: actor.userId,
      summary: `${rfpNumber} award to ${win.vendor}: ${usd(win.contractValue)}${alts.length ? ` incl. alternates ${alts.join(", ")}` : ""} (${lv.bidders.length} bid${lv.bidders.length === 1 ? "" : "s"}; budget ${usd(lv.budget)})`,
    });
    await c.query(`update project set stage_id = (select id from stage where code = 'award'), last_activity_at = now() where id = $1`, [lv.rfp.project_id]);
    return { awardId: award.id as string, contractValue: win.contractValue };
  });
}

onApproval("award", {
  approved: async (c, awardId, actor) => {
    await c.query(`update award set status = 'approved', decided_at = now() where id = $1`, [awardId]);
    await createContractFromAward(c, awardId, actor.userId);
  },
  returned: async (c, awardId) => {
    await c.query(`update award set status = 'returned', decided_at = now() where id = $1`, [awardId]);
  },
});

/**
 * The winning bid becomes the contract, its schedule of values and the budget commitment with
 * no re-keying (capability 10). Each SOV line keeps a link to the bid line it came from and to
 * the budget line it commits against; committed $ appears in the budget once the contract is executed.
 */
export async function createContractFromAward(c: PoolClient, awardId: string, userId: string) {
  const aw = (await c.query(
    `select a.*, r.project_id, r.requirements, r.rfp_number, p.project_code, i.vendor_id
       from award a join rfp r on r.id = a.rfp_id join project p on p.id = r.project_id join bid b on b.id = a.bid_id join invitation i on i.id = b.invitation_id where a.id = $1`,
    [awardId],
  )).rows[0];
  const n = await nextNumber(c as any, `contract:${aw.project_code}`);
  const number = contractNumber(aw.project_code, n);
  const defaults = (await c.query(`select value from app_setting where key = 'contract.defaults'`)).rows[0]?.value ?? {};
  const req = aw.requirements ?? {};
  const unitPrices = (await c.query(
    `select f.line_no, f.description, f.unit, bl.unit_price from bid_line bl join bid_form_line f on f.id = bl.bid_form_line_id
      where bl.bid_id = $1 and f.kind = 'unit_price' and bl.included and bl.unit_price is not null order by f.sort_order`, [aw.bid_id])).rows;
  const k = (await c.query(
    `insert into contract (contract_number, project_id, vendor_id, award_id, kind, original_value, retainage_pct, payment_terms, warranty_years, key_terms, status, sov_from_bid_id, created_by, updated_by)
     values ($1,$2,$3,$4,'project',$5,$6,$7,$8,$9,'draft',$10,$11,$11) returning id`,
    [number, aw.project_id, aw.vendor_id, awardId, aw.contract_value, req.retainage_pct ?? defaults.retainage_pct ?? 10, req.payment_terms ?? defaults.payment_terms,
     defaults.warranty_years ?? 2, { unit_prices: unitPrices, source: aw.rfp_number }, aw.bid_id, userId],
  )).rows[0];
  const lines = (await c.query(
    `select bl.*, f.line_no, f.description, f.kind, f.cost_code_id from bid_line bl join bid_form_line f on f.id = bl.bid_form_line_id
      where bl.bid_id = $1 and bl.included and bl.amount is not null and (f.kind = 'base' or (f.kind = 'alternate' and f.line_no = any($2))) order by f.sort_order`,
    [aw.bid_id, aw.alternates_accepted],
  )).rows;
  for (const l of lines) {
    let bud = l.cost_code_id ? (await c.query(`select id from budget_line where project_id = $1 and cost_code_id = $2`, [aw.project_id, l.cost_code_id])).rows[0] : null;
    if (!bud && l.cost_code_id) bud = (await c.query(`insert into budget_line (project_id, cost_code_id, original_budget) values ($1,$2,0) returning id`, [aw.project_id, l.cost_code_id])).rows[0];
    await c.query(
      `insert into sov_line (contract_id, line_no, description, scheduled_value, budget_line_id, source_bid_line_id) values ($1,$2,$3,$4,$5,$6)`,
      [k.id, l.line_no, l.kind === "alternate" && !/^alternate\b/i.test(l.description) ? `Alternate: ${l.description}` : l.description, l.amount, bud?.id ?? null, l.id],
    );
  }
  await c.query(`update rfp set status = 'awarded', updated_at = now() where id = (select rfp_id from award where id = $1)`, [awardId]);
  await c.query(`update project set stage_id = (select id from stage where code = 'contract'), last_activity_at = now() where id = $1`, [aw.project_id]);
  await c.query(`insert into decision_log (project_id, decision, rationale, decided_by) values ($1,$2,$3,$4)`, [aw.project_id, `Contract ${number} drafted from the approved award`, aw.memo, userId]);
  return { contractId: k.id as string, number };
}

export async function contractDetail(actor: Actor, number: string) {
  const k = await one<any>(
    `select k.*, v.name vendor_name, v.short_name, p.project_code, p.name project_name, p.property_id, pr.region_id, pr.name pname, pr.state, pr.legal_description,
            r.rfp_number, r.scope, r.title rfp_title
       from contract k join vendor v on v.id = k.vendor_id join project p on p.id = k.project_id join property pr on pr.id = p.property_id
       left join award a on a.id = k.award_id left join rfp r on r.id = a.rfp_id where k.contract_number = $1`,
    [number],
  );
  if (!k || !actor.canAccessProperty(k.property_id, k.region_id)) return null;
  const sov = await query<any>(`select s.*, cc.code cost_code from sov_line s left join budget_line b on b.id = s.budget_line_id left join cost_code cc on cc.id = b.cost_code_id where contract_id = $1 order by s.line_no`, [k.id]);
  return { contract: k, sov };
}

/** Generates the contract from GIT's template with the award's terms, files it as a draft for signature. */
export async function prepareForSignature(actor: Actor, number: string) {
  assertCan(actor, "contract.edit");
  const d = await contractDetail(actor, number);
  if (!d) throw new Error("Contract not found");
  if (d.contract.status !== "draft") throw new Error(`Contract is ${d.contract.status.replace(/_/g, " ")}`);
  const comp = await compliance(d.contract.vendor_id, d.contract.state);
  if (!comp.ok) throw new Error(`Paperwork missing: ${comp.issues.join("; ")}`);
  const buf = await buildContractDocx(d);
  const f = await fileDocument(actor, { originalName: `${number}.docx`, content: buf, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", source: "generated" },
    { projectCode: d.contract.project_code, docType: "Contract-Draft", party: d.contract.short_name, docDate: pacificDate(), confidence: 1 });
  // DocuSign (4.3) when configured: vendor signs first, then GIT's signatory. Until it is configured,
  // or for a wet-signed copy, the signed PDF is uploaded on the contract page instead.
  let envelopeId: string | null = null;
  if (docusignEnabled()) {
    const vc = await one<{ name: string; email: string }>(`select name, email from vendor_contact where vendor_id = $1 order by is_primary desc, name limit 1`, [d.contract.vendor_id]);
    if (!vc?.email) throw new Error(`${d.contract.vendor_name} has no contact email for DocuSign`);
    const sig = await one<{ value: { email: string; name: string } }>(`select value from app_setting where key = 'contract.signatory'`);
    if (!sig?.value?.email) throw new Error("Set who signs contracts for GIT (setting contract.signatory)");
    const cc = (await one<{ value: string[] }>(`select value from app_setting where key = 'contract.signatureCc'`))?.value ?? [];
    envelopeId = await sendContractEnvelope({
      contractNumber: number, contractId: d.contract.id, documentName: f.name ?? `${number}.docx`, docx: buf,
      contractor: { name: vc.name || d.contract.vendor_name, email: vc.email }, owner: { name: sig.value.name, email: sig.value.email },
      cc: [{ name: actor.displayName, email: actor.email }, ...cc.map((e) => ({ name: e, email: e }))],
    });
  }
  await withTx(actor.userId, (c) =>
    c.query(
      `update contract set status = 'out_for_signature', draft_document_id = $2, docusign_envelope_id = $3, signature_status = $4,
                           signature_sent_by = $5, signature_note = null, updated_at = now() where id = $1`,
      [d.contract.id, f.documentId, envelopeId, envelopeId ? "sent" : null, actor.userId],
    ),
  );
  return { file: f, docusign: !!envelopeId, envelopeId };
}

/** Pulls the envelope back (vendor asked for a change, wrong signer): voids it in DocuSign and returns the contract to draft. */
export async function voidSignature(actor: Actor, number: string, reason: string) {
  assertCan(actor, "contract.edit");
  const d = await contractDetail(actor, number);
  if (!d) throw new Error("Contract not found");
  if (d.contract.status !== "out_for_signature") throw new Error("Contract is not out for signature");
  if (reason.trim().length < 5) throw new Error("Give a reason; DocuSign shows it to the signers");
  if (d.contract.docusign_envelope_id) await voidEnvelope(d.contract.docusign_envelope_id, reason);
  await withTx(actor.userId, (c) =>
    c.query(`update contract set status = 'draft', signature_status = case when docusign_envelope_id is null then null else 'voided' end, signature_note = $2, updated_at = now() where id = $1`, [d.contract.id, reason.trim()]),
  );
}

/**
 * DocuSign Connect message (already HMAC-verified by the route). Logged every time; repeats ignored.
 * Completed → download the signed PDF with DocuSign's certificate, file it, execute the contract
 * as the person who sent it. Declined or voided in DocuSign → back to draft with the reason.
 */
export async function handleConnectEvent(payload: any): Promise<{ status: string }> {
  const event = String(payload?.event ?? "");
  const envelopeId = String(payload?.data?.envelopeId ?? "");
  if (!event || !envelopeId) return { status: "ignored: not an envelope event" };
  const k = await one<any>(`select k.id, k.contract_number, k.status, k.signature_sent_by from contract k where k.docusign_envelope_id = $1`, [envelopeId]);
  const ev = await one<{ id: string }>(
    `insert into docusign_event (envelope_id, event, event_at, contract_id, payload) values ($1,$2,$3,$4,$5) returning id`,
    [envelopeId, event, payload?.generatedDateTime ?? null, k?.id ?? null, payload],
  );
  const done = (status: string, error?: string) =>
    one(`update docusign_event set processed = $2, error = $3 where id = $1`, [ev!.id, !error, error ?? null]).then(() => ({ status }));
  if (!k) return done("ignored: unknown envelope");
  try {
    const summary = payload?.data?.envelopeSummary ?? {};
    if (event === "envelope-completed") {
      if (k.status === "executed") return done("already executed");
      const actor = k.signature_sent_by ? await loadActor(k.signature_sent_by) : null;
      if (!actor) throw new Error("The person who sent the contract is no longer active; upload the signed copy instead");
      const pdf = await downloadCompleted(envelopeId);
      await recordExecuted(actor, k.contract_number, { name: `${k.contract_number}-signed.pdf`, content: pdf, contentType: "application/pdf" }, "docusign");
      return done("executed");
    }
    if (event === "envelope-declined" || event === "envelope-voided") {
      const who = (summary?.recipients?.signers ?? []).find((s: any) => s.status === "declined");
      const note = event === "envelope-declined" ? `Declined in DocuSign${who ? ` by ${who.name}` : ""}${who?.declinedReason ? `: ${who.declinedReason}` : ""}` : `Voided in DocuSign${summary?.voidedReason ? `: ${summary.voidedReason}` : ""}`;
      await one(`update contract set status = 'draft', signature_status = $2, signature_note = $3, updated_at = now() where id = $1 and status = 'out_for_signature'`, [k.id, event === "envelope-declined" ? "declined" : "voided", note]);
      return done("returned to draft");
    }
    if (event === "envelope-delivered") {
      await one(`update contract set signature_status = 'delivered' where id = $1 and signature_status = 'sent'`, [k.id]);
      return done("delivered");
    }
    if (event === "recipient-completed" && String(payload?.data?.recipientId) === "1") {
      await one(`update contract set signature_status = 'signed_by_vendor' where id = $1 and signature_status in ('sent','delivered')`, [k.id]);
      return done("vendor signed");
    }
    return done(`noted: ${event}`);
  } catch (e) {
    await done("error", e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/** Executed copy received (DocuSign webhook or upload): file it, lock the contract, start the job's controls. */
export async function recordExecuted(actor: Actor, number: string, file: { name: string; content: Buffer; contentType: string }, via: "upload" | "docusign" = "upload") {
  assertCan(actor, "contract.edit");
  const d = await contractDetail(actor, number);
  if (!d) throw new Error("Contract not found");
  if (d.contract.status !== "out_for_signature") throw new Error("Generate the contract for signature first");
  if (!/pdf$/i.test(file.name) && file.contentType !== "application/pdf") throw new Error("Upload the signed contract as a PDF");
  const today = pacificDate();
  const f = await fileDocument(actor, { originalName: file.name, content: file.content, contentType: "application/pdf", source: via },
    { projectCode: d.contract.project_code, docType: "Contract-Executed", party: d.contract.short_name, docDate: today, amount: Number(d.contract.original_value), confidence: 1 });
  await withTx(actor.userId, async (c) => {
    await c.query(`update contract set status = 'executed', executed_document_id = $2, signed_via = $3, signature_status = case when $3 = 'docusign' then 'completed' else signature_status end, executed_at = now(), start_date = coalesce(start_date, current_date), updated_at = now() where id = $1`, [d.contract.id, f.documentId, via]);
    // Rule "Contract executed" (section 11): closeout checklist; commitment shows in the budget via the executed status.
    const tpl = (await c.query(`select items from checklist_template where kind = 'closeout' order by name limit 1`)).rows[0];
    for (const it of tpl?.items ?? []) {
      await c.query(`insert into closeout_item (project_id, key, label) values ($1,$2,$3) on conflict (project_id, key) do nothing`, [d.contract.project_id, it.key, it.label]);
    }
    await c.query(`insert into decision_log (project_id, decision, rationale, decided_by) values ($1,$2,$3,$4)`, [d.contract.project_id, `Contract ${number} executed`, `Signed copy ${via === "docusign" ? "received from DocuSign and " : ""}filed as ${f.name}`, actor.userId]);
  });
  // Baseline at contract award (7.4)
  await saveBaseline(actor, d.contract.project_id);
  return { file: f };
}

/** Regret letters to the other bidders (8.4), from the PM's Outlook, after the award is approved. */
export async function sendRegrets(actor: Actor, rfpNumber: string, delegatedToken: string | null) {
  assertCan(actor, "rfp.edit");
  const r = await one<any>(`select r.*, a.bid_id, a.status award_status from rfp r join award a on a.rfp_id = r.id where r.rfp_number = $1`, [rfpNumber]);
  if (!r || r.award_status !== "approved") throw new Error("Send regret letters after the award is approved");
  const others = await query<any>(
    `select distinct v.id, v.name, c.email from invitation i join vendor v on v.id = i.vendor_id
       join lateral (select email from vendor_contact where vendor_id = v.id order by is_primary desc limit 1) c on true
      where i.rfp_id = $1 and i.submitted_at is not null and not exists (select 1 from bid b where b.invitation_id = i.id and b.id = $2)`,
    [r.id, r.bid_id],
  );
  for (const o of others) {
    await sendMail({
      fromUserId: actor.userId, fromAddress: actor.email, to: [o.email], subject: `${rfpNumber} · Bid result · ${r.title}`,
      html: `<p>${escapeHtml(o.name)},</p><p>Thank you for your bid on ${escapeHtml(rfpNumber)}, ${escapeHtml(r.title)}. After review, the work has been awarded to another bidder.</p><p>We appreciate the time you put into your proposal and look forward to inviting you on future work.</p><p>${escapeHtml(actor.displayName)}<br>Gaines Investment Trust</p>`,
      projectId: r.project_id, rfpId: r.id, vendorId: o.id,
    }, delegatedToken);
  }
  return { sent: others.length };
}

export async function contractsForProject(projectId: string) {
  return query<any>(`select k.*, v.name vendor_name from contract k join vendor v on v.id = k.vendor_id where project_id = $1 order by contract_number`, [projectId]);
}
