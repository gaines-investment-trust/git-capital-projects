import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { Client } from "pg";

const base = process.env.TEST_DATABASE_URL;
const url = base ? `${base}_s4` : undefined;
const run = url ? describe : describe.skip;

run("sprint 4: leveling, award, contract, execution", () => {
  let m: any, root: string;
  let joe: string, sean: string, jeff: string, joeA: any, seanA: any, jeffA: any;
  let projectId: string, projectCode: string, number: string;
  const V: Record<string, string> = {}, tok: Record<string, string> = {}, L: Record<string, string> = {};
  let awardId: string, contractNo: string;
  const prompts: string[] = [];

  beforeAll(async () => {
    const admin = new Client({ connectionString: url!.replace(/\/[^/]+$/, "/postgres") });
    await admin.connect();
    const name = url!.split("/").pop()!;
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.query(`create database ${name}`);
    await admin.end();
    execSync("node scripts/migrate.mjs", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    root = mkdtempSync(join(tmpdir(), "gcp4-"));
    Object.assign(process.env, { DATABASE_URL: url, AUTH_SECRET: "test-secret-0123456789", DOCSTORE: "local", LOCAL_DOCSTORE_DIR: join(root, "sp"), APP_BASE_URL: "https://cpp.example" });
    m = {
      db: await import("@/lib/db"), access: await import("@/lib/access"), projects: await import("@/services/projects"), rfps: await import("@/services/rfps"),
      vendors: await import("@/services/vendors"), approvals: await import("@/services/approvals"), people: await import("@/services/people"),
      leveling: await import("@/services/leveling"), contracts: await import("@/services/contracts"), ai: await import("@/lib/ai"),
    };
    joe = (await m.db.query(`insert into app_user(email, display_name, kind) values ('joeg@gainesinvestmenttrust.com','Joe Gerber','employee') returning id`))[0].id;
    await m.db.query(`insert into user_role(user_id, role_id, scope_kind) select $1, id, 'all' from role where code in ('executive','admin')`, [joe]);
    joeA = await m.access.loadActor(joe);
    const prop = (await m.db.query(`insert into property(code, name, state, region_id) values ('TUS','Tuscany Square','TX',(select id from region where code='TX')) returning id`))[0].id;
    sean = (await m.people.addPerson(joeA, { email: "sean@gainesinvestmenttrust.com", displayName: "Sean Hunter", roleCode: "capex_pm", scopeKind: "property", scopeIds: [prop], approvalLimit: 9999.99 })).userId;
    jeff = (await m.people.addPerson(joeA, { email: "jeffg@gainesinvestmenttrust.com", displayName: "Jeff Gaines", roleCode: "executive", scopeKind: "all" })).userId;
    seanA = await m.access.loadActor(sean); jeffA = await m.access.loadActor(jeff);
    const p = await m.projects.createProject(seanA, { propertyId: prop, projectTypeCode: "roof", name: "Roof", managerUserId: sean, plannedStart: "2030-03-02", budgetSource: "reserves", budgetAmount: 412000 });
    projectId = p.id; projectCode = p.code;
    number = (await m.rfps.createRfp(seanA, projectCode)).number;
    await m.rfps.updateRfp(seanA, number, { scope: { summary: "Tear off and replace the roofing system on buildings 1 through 8 including deck repairs.", items: ["Tear off", "Re-roof"] }, bidDueAt: "2030-01-22T22:00:00Z", questionsDueAt: "2030-01-15T22:00:00Z" });
    await m.rfps.submitRfp(seanA, number);
    const a = (await m.approvals.myOpenApprovals(joe))[0];
    await m.approvals.decide(joeA, { approvalId: a.id, decision: "approved" });
    await m.rfps.issueRfp(seanA, number);
    for (const [k, name, email] of [["brand", "Brandpoint Roofing", "dana@brandpoint.com"], ["lone", "Lone Star Roof Systems", "ray@lonestar.com"], ["peak", "Peak Roofing", "kim@peakroof.com"]]) {
      V[k] = (await m.vendors.createVendor(seanA, { name, trades: ["roofing"], statesServed: ["TX"], contactName: k, contactEmail: email })).id;
    }
    // Brandpoint and Peak have complete paperwork; Lone Star has none.
    for (const k of ["brand", "peak"]) {
      await m.vendors.addCoi(seanA, { vendorId: V[k], expiresOn: "2099-01-01" });
      await m.vendors.addLicense(seanA, { vendorId: V[k], state: "TX", licenseNumber: `TX-${k}` });
      const d = (await m.db.query(`insert into document (sp_drive_id, sp_item_id, sp_path, file_name, doc_type, source) values ('local',$1,$1,'w9.pdf','W9','upload') returning id`, [`w9-${k}`]))[0].id;
      await m.db.query(`update vendor set w9_doc_id = $2 where id = $1`, [V[k], d]);
    }
    const res = await m.rfps.inviteVendors(seanA, number, [V.brand, V.lone, V.peak], null);
    res.forEach((r: any, i: number) => (tok[["brand", "lone", "peak"][i]] = r.link.split("/").pop()));
    const view = await m.rfps.portalView(tok.brand);
    for (const l of view.lines) L[l.line_no] = l.id;
    const bid = (amts: Record<string, number | null>, unit3: number) => ({
      lines: ["1", "2", "3", "4", "5", "A1"].map((no) => ({ lineId: L[no], unitPrice: no === "3" ? unit3 : null, amount: no === "3" ? null : amts[no] ?? null, included: amts[no] !== null || no === "3" })),
      scheduleDays: 45,
    });
    await m.rfps.portalSubmitBid(tok.brand, bid({ "1": 5000, "2": 300000, "4": 12000, "5": 3500, A1: 9000 }, 6.5));
    await m.rfps.portalSubmitBid(tok.lone, bid({ "1": 4000, "2": 280000, "4": null, "5": 3000, A1: 8000 }, 6.0)); // excludes gutters
    await m.rfps.portalSubmitBid(tok.peak, bid({ "1": 9000, "2": 310000, "4": 18000, "5": 4000, A1: 12000 }, 7.0)); // line 1 high
  });
  afterAll(async () => { m.ai.setAiClient(null); await m?.db.pool.end(); });

  it("levels the bids: plugs fill excluded lines with the median, totals compare on equal terms", async () => {
    const lv = await m.leveling.level(seanA, number);
    const by = Object.fromEntries(lv.bidders.map((b: any) => [b.vendor, b]));
    expect(by["Brandpoint Roofing"].baseTotal).toBe(320500);
    expect(by["Lone Star Roof Systems"].baseTotal).toBe(287000);
    expect(by["Lone Star Roof Systems"].plugTotal).toBe(15000); // median of 12,000 and 18,000
    expect(by["Lone Star Roof Systems"].leveledTotal).toBe(302000);
    expect(by["Lone Star Roof Systems"].flags.join(" ")).toMatch(/Line 4 \(Gutters and downspouts\) excluded/);
    expect(by["Peak Roofing"].cells[L["1"]].outlier).toBe("high");
    expect(lv.bidders.map((b: any) => b.vendor)).toEqual(["Lone Star Roof Systems", "Brandpoint Roofing", "Peak Roofing"]);
    expect(lv.recommended.vendor).toBe("Brandpoint Roofing"); // lowest compliant
    const withAlt = await m.leveling.level(seanA, number, { alternates: [L.A1] });
    expect(withAlt.bidders.find((b: any) => b.vendor === "Brandpoint Roofing").contractValue).toBe(329500);
    const noPlugs = await m.leveling.level(seanA, number, { plugs: false });
    expect(noPlugs.bidders.find((b: any) => b.vendor === "Lone Star Roof Systems").leveledTotal).toBe(287000);
  });

  it("runs gap analysis with rules, adds Claude's findings when configured, logs the run and redacts", async () => {
    const rulesOnly = await m.leveling.gapAnalysis(seanA, number);
    expect(rulesOnly.usedClaude).toBe(false);
    expect(rulesOnly.findings.some((f: any) => f.vendor === "Lone Star Roof Systems" && f.severity === "gap")).toBe(true);
    expect(rulesOnly.findings.some((f: any) => f.vendor === "Lone Star Roof Systems" && /Paperwork/.test(f.finding))).toBe(true);

    await m.db.query(`update rfp set scope = jsonb_set(scope, '{summary}', '"Deck repairs; owner SSN 123-45-6789 must never be sent"') where rfp_number = $1`, [number]);
    m.ai.setAiClient({ messages: { create: async (args: any) => {
      prompts.push(args.messages[0].content);
      return { usage: { input_tokens: 900, output_tokens: 80 }, content: [{ type: "tool_use", name: "result", input: { findings: [{ vendor: "Peak Roofing", severity: "warning", finding: "Line 1 mobilisation is about 80% above the other bids; ask what it includes." }] } }] };
    } } });
    const withAi = await m.leveling.gapAnalysis(seanA, number);
    expect(withAi.usedClaude).toBe(true);
    expect(withAi.findings.find((f: any) => f.source === "claude")).toMatchObject({ vendor: "Peak Roofing", severity: "warning" });
    expect(prompts[0]).toContain("[SSN REDACTED]");
    expect(prompts[0]).not.toContain("123-45-6789");
    const runs = await m.db.query(`select job, model, tokens_in, status from ai_run`);
    expect(runs[0]).toMatchObject({ job: "gap_analysis", model: "claude-sonnet-5-5", tokens_in: 900, status: "ok" });
    const saved = await m.leveling.savedFindings((await m.db.query(`select id from rfp where rfp_number = $1`, [number]))[0].id);
    expect(saved.length).toBe(withAi.findings.length);
    m.ai.setAiClient(null);
  });

  it("blocks an award to a vendor with missing paperwork or unpriced scope", async () => {
    const inv = async (k: string) => (await m.db.query(`select id from invitation where vendor_id = $1`, [V[k]]))[0].id;
    await expect(m.contracts.requestAward(seanA, number, { invitationId: await inv("lone"), memo: "Lowest leveled total after plugs." })).rejects.toThrow(/paperwork/);
    await m.db.query(`update vendor set approved_status = 'approved' where id = $1`, [V.lone]);
    await m.vendors.addCoi(seanA, { vendorId: V.lone, expiresOn: "2099-01-01" });
    await m.vendors.addLicense(seanA, { vendorId: V.lone, state: "TX", licenseNumber: "TX-lone" });
    const d = (await m.db.query(`insert into document (sp_drive_id, sp_item_id, sp_path, file_name, doc_type, source) values ('local','w9-lone','w9-lone','w9.pdf','W9','upload') returning id`))[0].id;
    await m.db.query(`update vendor set w9_doc_id = $2 where id = $1`, [V.lone, d]);
    await expect(m.contracts.requestAward(seanA, number, { invitationId: await inv("lone"), memo: "Lowest leveled total after plugs." })).rejects.toThrow(/did not price line 4/);
  });

  it("routes the award PM → COO → President and turns the winning bid into the contract and SOV", async () => {
    const inv = (await m.db.query(`select id from invitation where vendor_id = $1`, [V.brand]))[0].id;
    const r = await m.contracts.requestAward(seanA, number, { invitationId: inv, alternates: [L.A1], memo: "Lowest compliant bid; complete scope; 2-year warranty." });
    awardId = r.awardId;
    expect(r.contractValue).toBe(329500);
    const coo = (await m.approvals.myOpenApprovals(joe)).find((a: any) => a.object_type === "award");
    expect(coo.amount).toBe("329500.00");
    expect(await m.approvals.myOpenApprovals(jeff)).toHaveLength(0); // President sees it only after the COO
    await m.approvals.decide(joeA, { approvalId: coo.id, decision: "approved" });
    const pres = (await m.approvals.myOpenApprovals(jeff))[0];
    const done = await m.approvals.decide(jeffA, { approvalId: pres.id, decision: "approved" });
    expect(done.status).toBe("fully_approved");

    const k = (await m.db.query(`select * from contract where award_id = $1`, [awardId]))[0];
    contractNo = k.contract_number;
    expect(contractNo).toBe(`${projectCode}-K01`);
    expect(Number(k.original_value)).toBe(329500);
    expect(Number(k.retainage_pct)).toBe(10);
    expect(k.key_terms.unit_prices[0]).toMatchObject({ line_no: "3", unit: "SF" });
    const sov = await m.db.query(`select s.line_no, s.scheduled_value, cc.code from sov_line s join budget_line b on b.id = s.budget_line_id join cost_code cc on cc.id = b.cost_code_id where contract_id = $1 order by line_no`, [k.id]);
    expect(sov.map((s: any) => s.line_no)).toEqual(["1", "2", "4", "5", "A1"]);
    expect(sov.reduce((a: number, s: any) => a + Number(s.scheduled_value), 0)).toBe(329500);
    expect(new Set(sov.map((s: any) => s.code))).toEqual(new Set(["07-310"]));
    expect((await m.db.query(`select status from rfp where rfp_number = $1`, [number]))[0].status).toBe("awarded");
    // Not committed until executed
    const b0 = await m.db.query(`select sum(committed) c from v_budget_line where project_id = $1`, [projectId]);
    expect(Number(b0[0].c)).toBe(0);
  });

  it("generates the contract for signature, records the signed copy, and commits the budget", async () => {
    const prep = await m.contracts.prepareForSignature(seanA, contractNo);
    expect(prep.file.name).toMatch(new RegExp(`^${projectCode}_Contract-Draft_BrandpointRoofing_\\d{4}-\\d{2}-\\d{2}_v1\\.docx$`));
    await expect(m.contracts.recordExecuted(seanA, contractNo, { name: "signed.docx", content: Buffer.from("x"), contentType: "application/msword" })).rejects.toThrow(/PDF/);
    const ex = await m.contracts.recordExecuted(seanA, contractNo, { name: "Brandpoint signed.pdf", content: Buffer.from("%PDF-1.4 signed"), contentType: "application/pdf" });
    expect(ex.file.name).toMatch(/_Contract-Executed_BrandpointRoofing_.*_v1\.pdf$/);
    expect(ex.file.path).toContain("/05 Contracts/");
    const b = await m.db.query(`select sum(committed) c from v_budget_line where project_id = $1`, [projectId]);
    expect(Number(b[0].c)).toBe(329500);
    expect((await m.db.query(`select count(*)::int n from closeout_item where project_id = $1`, [projectId]))[0].n).toBe(9);
    expect((await m.db.query(`select baseline_end from project where id = $1`, [projectId]))[0].baseline_end).not.toBeNull();
    expect((await m.db.query(`select s.code from project p join stage s on s.id = p.stage_id where p.id = $1`, [projectId]))[0].code).toBe("contract");
  });

  it("sends regret letters only to the other bidders", async () => {
    const before = readdirSync(join(root, "outbox")).length;
    const r = await m.contracts.sendRegrets(seanA, number, null);
    expect(r.sent).toBe(2);
    expect(readdirSync(join(root, "outbox")).length).toBe(before + 2);
  });
});
