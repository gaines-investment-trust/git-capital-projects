import { z } from "zod";
import { withTx, query, one } from "@/lib/db";
import { type Actor, assertCan } from "@/lib/access";
import { askJson, aiEnabled } from "@/lib/ai";
import { compliance } from "./vendors";

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export type Cell = { amount: number | null; unitPrice: number | null; included: boolean; plug: number | null; outlier: "high" | "low" | null };
export type Bidder = {
  invitationId: string; bidId: string; vendorId: string; vendor: string; version: number; late: boolean;
  scheduleDays: number | null; warrantyYears: number | null; exclusions: string[];
  baseTotal: number; plugTotal: number; alternatesTotal: number; leveledTotal: number; contractValue: number;
  compliant: boolean; complianceIssues: string[]; flags: string[]; cells: Record<string, Cell>;
};

/**
 * Bid leveling (build prompt 8.4): every latest bid against the same bid-form lines.
 * Plugs fill excluded or missing base lines with the median of the other bids so totals compare
 * on equal terms; they are shown separately and never become contract value.
 */
export async function level(actor: Actor, rfpNumber: string, opts: { alternates?: string[]; plugs?: boolean } = {}) {
  const rfp = await one<any>(
    `select r.*, p.property_id, pr.region_id, pr.state, p.project_code, p.budget_amount from rfp r join project p on p.id = r.project_id join property pr on pr.id = p.property_id where r.rfp_number = $1`,
    [rfpNumber],
  );
  if (!rfp || !actor.canAccessProperty(rfp.property_id, rfp.region_id)) throw new Error("RFP not found");
  const usePlugs = opts.plugs !== false;
  const alternates = new Set(opts.alternates ?? []);
  const lines = await query<any>(`select * from bid_form_line where rfp_id = $1 order by sort_order`, [rfp.id]);
  const bids = await query<any>(
    `select distinct on (i.id) i.id invitation_id, i.is_late, v.id vendor_id, v.name vendor, b.*
       from invitation i join vendor v on v.id = i.vendor_id join bid b on b.invitation_id = i.id
      where i.rfp_id = $1 order by i.id, b.version desc`,
    [rfp.id],
  );
  const bidLines = bids.length ? await query<any>(`select * from bid_line where bid_id = any($1::uuid[])`, [bids.map((b) => b.id)]) : [];
  const byBid = new Map<string, Map<string, any>>();
  for (const bl of bidLines) {
    if (!byBid.has(bl.bid_id)) byBid.set(bl.bid_id, new Map());
    byBid.get(bl.bid_id)!.set(bl.bid_form_line_id, bl);
  }
  // Median per line across bids that priced it (for plugs and outliers)
  const med: Record<string, number | null> = {};
  for (const l of lines) {
    med[l.id] = median(bids.map((b) => byBid.get(b.id)?.get(l.id)).filter((x) => x && x.included && x.amount !== null).map((x) => Number(x.amount)));
  }

  const bidders: Bidder[] = [];
  for (const b of bids) {
    const m = byBid.get(b.id) ?? new Map();
    const cells: Record<string, Cell> = {};
    let base = 0, plugs = 0, alts = 0;
    const flags: string[] = [];
    for (const l of lines) {
      const x = m.get(l.id);
      const amount = x && x.included && x.amount !== null ? Number(x.amount) : null;
      const missing = !x || !x.included;
      let plug: number | null = null;
      if (l.kind === "base") {
        if (amount !== null) base += amount;
        else if (missing) {
          flags.push(`Line ${l.line_no} (${l.description}) ${!x ? "not priced" : "excluded"}`);
          if (usePlugs && med[l.id] !== null) { plug = med[l.id]; plugs += plug!; }
        }
      }
      if (l.kind === "alternate" && alternates.has(l.id) && amount !== null) alts += amount;
      if (l.kind === "alternate" && alternates.has(l.id) && amount === null) flags.push(`Alternate ${l.line_no} not priced`);
      let outlier: Cell["outlier"] = null;
      const md = med[l.id];
      if (amount !== null && md && bids.length >= 3) {
        if (amount > md * 1.3) outlier = "high";
        else if (amount < md * 0.7) outlier = "low";
      }
      if (outlier) flags.push(`Line ${l.line_no} is ${outlier === "high" ? "over 30% above" : "over 30% below"} the median of the other bids`);
      cells[l.id] = { amount, unitPrice: x?.unit_price === null || x?.unit_price === undefined ? null : Number(x.unit_price), included: !!x?.included, plug, outlier };
    }
    if (b.is_late) flags.push("Submitted after the deadline");
    if (!b.schedule_days) flags.push("No schedule given");
    if (b.exclusions?.filter(Boolean).length) flags.push(`Exclusions declared: ${b.exclusions.join("; ")}`);
    const comp = await compliance(b.vendor_id, rfp.state);
    bidders.push({
      invitationId: b.invitation_id, bidId: b.id, vendorId: b.vendor_id, vendor: b.vendor, version: b.version, late: b.is_late,
      scheduleDays: b.schedule_days, warrantyYears: b.warranty_years === null ? null : Number(b.warranty_years), exclusions: b.exclusions ?? [],
      baseTotal: base, plugTotal: plugs, alternatesTotal: alts, leveledTotal: base + plugs + alts, contractValue: base + alts,
      compliant: comp.ok, complianceIssues: comp.issues, flags, cells,
    });
  }
  const leveled = bidders.map((b) => b.leveledTotal);
  const mdTotal = median(leveled);
  for (const b of bidders) {
    if (mdTotal && bidders.length >= 3 && b.leveledTotal < mdTotal * 0.85) b.flags.push("Total is more than 15% below the median: check for missed scope");
  }
  bidders.sort((a, b) => a.leveledTotal - b.leveledTotal);
  const recommended = bidders.find((b) => b.compliant) ?? null;
  return { rfp, lines, bidders, recommended, budget: Number(rfp.budget_amount ?? 0) };
}

export async function closeBidding(actor: Actor, rfpNumber: string) {
  assertCan(actor, "rfp.edit");
  await withTx(actor.userId, async (c) => {
    const r = (await c.query(`select id, status from rfp where rfp_number = $1 for update`, [rfpNumber])).rows[0];
    if (!r) throw new Error("RFP not found");
    if (r.status !== "issued") throw new Error(`Bidding can be closed only while the RFP is issued (now ${r.status})`);
    await c.query(`update rfp set status = 'closed', updated_at = now() where id = $1`, [r.id]);
  });
}

export type Finding = { vendor: string; vendorId: string | null; severity: "info" | "warning" | "gap"; finding: string; source: "rules" | "claude" };

/**
 * Gap analysis: the rule-based flags above, plus Claude reading the scope against each bid's
 * prices and exclusions when the API key is configured. Results are saved for the audit trail.
 */
export async function gapAnalysis(actor: Actor, rfpNumber: string) {
  assertCan(actor, "rfp.edit");
  const lv = await level(actor, rfpNumber);
  const findings: Finding[] = lv.bidders.flatMap((b) => [
    ...b.flags.map((f) => ({ vendor: b.vendor, vendorId: b.vendorId, severity: (/not priced|excluded|below the median/.test(f) ? "gap" : "warning") as Finding["severity"], finding: f, source: "rules" as const })),
    ...b.complianceIssues.map((f) => ({ vendor: b.vendor, vendorId: b.vendorId, severity: "warning" as const, finding: `Paperwork: ${f}`, source: "rules" as const })),
  ]);

  let runId: string | null = null;
  if (aiEnabled() && lv.bidders.length) {
    const s = lv.rfp.scope ?? {};
    const prompt = [
      `RFP ${lv.rfp.rfp_number}: ${lv.rfp.title}`,
      `Scope summary: ${s.summary ?? ""}`,
      `Scope items:\n${(s.items ?? []).map((x: string, i: number) => `${i + 1}. ${x}`).join("\n")}`,
      `Exclusions bidders must declare: ${s.exclusions ?? "none listed"}`,
      `Bid form lines:\n${lv.lines.map((l: any) => `${l.line_no} | ${l.description} | ${l.kind} | qty ${l.quantity ?? "vendor take-off"} ${l.unit}`).join("\n")}`,
      ...lv.bidders.map((b) => `Bid from ${b.vendor} (version ${b.version}): base total ${b.baseTotal}; schedule ${b.scheduleDays ?? "not given"} days; warranty ${b.warrantyYears ?? "not given"} years; exclusions: ${b.exclusions.join("; ") || "none"}.\nLines: ${lv.lines.map((l: any) => { const c = b.cells[l.id]; return `${l.line_no}=${c.included ? (c.amount ?? (c.unitPrice !== null ? `unit ${c.unitPrice}` : "blank")) : "EXCLUDED"}`; }).join(", ")}`),
    ].join("\n\n");
    const r = await askJson<{ findings: { vendor: string; severity: "info" | "warning" | "gap"; finding: string }[] }>({
      job: "gap_analysis", tier: "review", actorUserId: actor.userId, objectType: "rfp", objectId: lv.rfp.id,
      system: "You review construction bids for a multifamily property owner. Compare each bid with the scope and the other bids. Report only concrete, checkable issues: scope a bid appears not to cover, exclusions that conflict with the scope, qualifications, prices out of line with the other bids, and missing schedule or warranty. One short sentence each, naming the bid-form line where relevant. Do not restate totals or recommend a winner.",
      prompt,
      schema: { type: "object", properties: { findings: { type: "array", items: { type: "object", properties: { vendor: { type: "string" }, severity: { type: "string", enum: ["info", "warning", "gap"] }, finding: { type: "string" } }, required: ["vendor", "severity", "finding"] } } }, required: ["findings"] },
    });
    if (r) {
      runId = r.runId;
      for (const f of r.data.findings ?? []) {
        const b = lv.bidders.find((x) => x.vendor.toLowerCase() === String(f.vendor).toLowerCase());
        findings.push({ vendor: b?.vendor ?? f.vendor, vendorId: b?.vendorId ?? null, severity: f.severity, finding: f.finding, source: "claude" });
      }
    }
  }
  await withTx(actor.userId, async (c) => {
    await c.query(`delete from ai_finding where object_type = 'rfp' and object_id = $1`, [lv.rfp.id]);
    for (const f of findings) {
      await c.query(`insert into ai_finding (ai_run_id, object_type, object_id, vendor_id, severity, finding, source) values ($1,'rfp',$2,$3,$4,$5,$6)`,
        [f.source === "claude" ? runId : null, lv.rfp.id, f.vendorId, f.severity, f.finding, f.source]);
    }
  });
  return { findings, usedClaude: runId !== null };
}

export async function savedFindings(rfpId: string) {
  return query<any>(`select f.*, v.name vendor from ai_finding f left join vendor v on v.id = f.vendor_id where object_type = 'rfp' and object_id = $1 order by v.name, f.severity desc, f.created_at`, [rfpId]);
}

/** One clarification email per vendor listing only that vendor's gaps (8.4). Sent only after the PM edits and confirms. */
export function clarificationDraft(vendor: string, rfpNumber: string, title: string, items: string[]) {
  return {
    subject: `${rfpNumber} · Bid clarification · ${title}`,
    body: `${vendor},\n\nThank you for your bid on ${rfpNumber}. Before we finish our review, please confirm or correct the following:\n\n${items.map((x, i) => `${i + 1}. ${x}`).join("\n")}\n\nPlease reply through your portal link or to this email. A revised bid can be submitted through the portal.\n\nThank you.`,
  };
}

export const AwardInput = z.object({ invitationId: z.string().uuid(), alternates: z.array(z.string().uuid()).default([]), memo: z.string().trim().min(20, "Write a short award memo (20+ characters)") });
