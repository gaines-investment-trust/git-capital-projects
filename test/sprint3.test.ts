import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { Client } from "pg";
import ExcelJS from "exceljs";
import JSZip from "jszip";

const base = process.env.TEST_DATABASE_URL;
const url = base ? `${base}_s3` : undefined;
const run = url ? describe : describe.skip;

run("sprint 3: vendors, RFPs, approvals, invitations, portal", () => {
  let m: any, root: string;
  let joe: string, sean: string, prop: string, projectCode: string;
  let joeA: any, seanA: any;
  let number: string;
  const vendors: Record<string, string> = {};
  const links: Record<string, string> = {};

  beforeAll(async () => {
    const admin = new Client({ connectionString: url!.replace(/\/[^/]+$/, "/postgres") });
    await admin.connect();
    const name = url!.split("/").pop()!;
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.query(`create database ${name}`);
    await admin.end();
    execSync("node scripts/migrate.mjs", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    root = mkdtempSync(join(tmpdir(), "gcp3-"));
    Object.assign(process.env, { DATABASE_URL: url, AUTH_SECRET: "test-secret-0123456789", DOCSTORE: "local", LOCAL_DOCSTORE_DIR: join(root, "sp"), APP_BASE_URL: "https://cpp.example" });
    m = {
      db: await import("@/lib/db"), access: await import("@/lib/access"), projects: await import("@/services/projects"),
      rfps: await import("@/services/rfps"), vendors: await import("@/services/vendors"), approvals: await import("@/services/approvals"),
      people: await import("@/services/people"),
    };
    joe = (await m.db.query(`insert into app_user(email, display_name, kind) values ('joeg@gainesinvestmenttrust.com','Joe Gerber','employee') returning id`))[0].id;
    await m.db.query(`insert into user_role(user_id, role_id, scope_kind) select $1, id, 'all' from role where code in ('executive','admin')`, [joe]);
    prop = (await m.db.query(`insert into property(code, name, state, region_id) values ('TUS','Tuscany Square','TX',(select id from region where code='TX')) returning id`))[0].id;
    joeA = await m.access.loadActor(joe);
    sean = (await m.people.addPerson(joeA, { email: "sean@gainesinvestmenttrust.com", displayName: "Sean Hunter", roleCode: "capex_pm", scopeKind: "property", scopeIds: [prop], approvalLimit: 9999.99 })).userId;
    seanA = await m.access.loadActor(sean);
    projectCode = (await m.projects.createProject(seanA, { propertyId: prop, projectTypeCode: "roof", name: "Roof replacement", managerUserId: sean, plannedStart: "2030-03-02", budgetSource: "reserves", budgetAmount: 412000 })).code;
  });
  afterAll(async () => { await m?.db.pool.end(); });

  it("creates an RFP with the next number, the type's bid form and GIT's requirements", async () => {
    const r = await m.rfps.createRfp(seanA, projectCode);
    number = r.number;
    expect(number).toBe("RFP-TUS-001");
    const d = await m.rfps.rfpDetail(seanA, number);
    expect(d.lines.map((l: any) => l.line_no)).toEqual(["1", "2", "3", "4", "5", "A1"]);
    expect(d.rfp.requirements.gl_each_occurrence).toBe(1000000);
    expect((await m.db.query(`select s.code from project p join stage s on s.id = p.stage_id where project_code = $1`, [projectCode]))[0].code).toBe("rfp");
  });

  it("blocks submission until the package is complete", async () => {
    await expect(m.rfps.submitRfp(seanA, number)).rejects.toThrow(/Scope summary/);
    await m.rfps.updateRfp(seanA, number, {
      scope: { summary: "Tear off and replace the roofing system on buildings 1 through 8, including deck repairs where found.", items: ["Remove existing shingles", "Install new underlayment and shingles"] },
      siteWalkAt: "2030-01-10T17:00:00Z", questionsDueAt: "2030-01-15T01:00:00Z", bidDueAt: "2030-01-22T22:00:00Z",
    });
    const d = await m.rfps.rfpDetail(seanA, number);
    expect(d.checks.filter((c: any) => c.level === "blocker")).toEqual([]);
    expect(d.checks.some((c: any) => /No quantity on lines? 2, 4/.test(c.message))).toBe(true);
  });

  it("rejects a bid form with duplicate line numbers", async () => {
    await expect(m.rfps.saveBidForm(seanA, number, [
      { line_no: "1", description: "A thing", unit: "LS", kind: "base" }, { line_no: "1", description: "Another", unit: "LS", kind: "base" },
    ])).rejects.toThrow(/unique/);
  });

  it("routes to the COO; the PM's own step counts as submission; changes reopen the draft", async () => {
    const s = await m.rfps.submitRfp(seanA, number);
    expect(s.status).toBe("in_review");
    expect(await m.approvals.myOpenApprovals(sean)).toHaveLength(0);
    const inbox = await m.approvals.myOpenApprovals(joe);
    expect(inbox).toHaveLength(1);
    await expect(m.rfps.updateRfp(seanA, number, { title: "x x x" })).rejects.toThrow(/Only a draft/);
    await expect(m.approvals.decide(seanA, { approvalId: inbox[0].id, decision: "approved" })).rejects.toThrow(/someone else/);
    await expect(m.approvals.decide(joeA, { approvalId: inbox[0].id, decision: "changes_requested" })).rejects.toThrow(/Add a note/);
    await m.approvals.decide(joeA, { approvalId: inbox[0].id, decision: "changes_requested", note: "Add quantities for lines 2 and 4" });
    expect((await m.rfps.rfpDetail(seanA, number)).rfp.status).toBe("draft");

    await m.rfps.submitRfp(seanA, number);
    const again = await m.approvals.myOpenApprovals(joe);
    const r = await m.approvals.decide(joeA, { approvalId: again[0].id, decision: "approved" });
    expect(r.status).toBe("fully_approved");
    expect((await m.rfps.rfpDetail(seanA, number)).rfp.status).toBe("approved");
    const log = await m.db.query(`select decision from decision_log where approval_id is not null order by decided_at`);
    expect(log.map((x: any) => x.decision)).toEqual(["rfp changes requested (step 2)", "rfp approved (step 2)"]);
  });

  it("issues the RFP as a Word document and an Excel bid form, filed by the naming convention", async () => {
    const r = await m.rfps.issueRfp(seanA, number);
    expect(r.rfpFile.name).toMatch(/^TUS-30-001_RFP_GIT_\d{4}-\d{2}-\d{2}_v1\.docx$/);
    expect(r.bidFormFile.name).toMatch(/^TUS-30-001_BidForm_GIT_\d{4}-\d{2}-\d{2}_v1\.xlsx$/);
    expect(r.rfpFile.path).toContain("/02 RFP/Issued/");
    const zip = await JSZip.loadAsync(readFileSync(join(root, "sp", r.rfpFile.path)));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("RFP-TUS-001");
    expect(xml).toContain("Tear off and replace the roofing system");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(readFileSync(join(root, "sp", r.bidFormFile.path)) as any);
    const ws = wb.getWorksheet("Bid form")!;
    const total = ws.getRow(ws.rowCount - 4).getCell(7).value as any;
    expect(total.formula).toContain("SUMIFS");
    expect((await m.db.query(`select s.code from project p join stage s on s.id = p.stage_id where project_code = $1`, [projectCode]))[0].code).toBe("bidding");
  });

  it("keeps the vendor directory free of duplicates and knows who is compliant", async () => {
    vendors.brand = (await m.vendors.createVendor(seanA, { name: "Brandpoint Roofing, LLC", trades: ["roofing"], statesServed: ["TX"], contactName: "Dana R.", contactEmail: "dana@brandpointroofing.com" })).id;
    vendors.lone = (await m.vendors.createVendor(seanA, { name: "Lone Star Roof Systems", trades: ["roofing"], statesServed: ["TX"], contactName: "Ray", contactEmail: "ray@lonestarroof.com" })).id;
    vendors.bad = (await m.vendors.createVendor(seanA, { name: "Cut Corner Roofing", trades: ["roofing"], statesServed: ["TX"], contactName: "Al", contactEmail: "al@cutcorner.com" })).id;
    await expect(m.vendors.createVendor(seanA, { name: "Brandpoint Roofing", contactName: "X", contactEmail: "x@other.com" })).rejects.toThrow(/duplicate/);
    await expect(m.vendors.createVendor(seanA, { name: "Brand Point Roof Co", contactName: "X", contactEmail: "sam@brandpointroofing.com" })).rejects.toThrow(/duplicate/);
    await m.vendors.addCoi(seanA, { vendorId: vendors.brand, expiresOn: "2099-06-30", glEachOccurrence: 1000000 });
    await m.vendors.addCoi(seanA, { vendorId: vendors.lone, expiresOn: "2020-01-01" });
    await m.vendors.setVendorStatus(joeA, vendors.bad, "do_not_use");
    const c1 = await m.vendors.compliance(vendors.brand, "TX");
    expect(c1.issues).toEqual(["No W-9 on file", "No TX license on file"]);
    await m.vendors.addLicense(seanA, { vendorId: vendors.brand, state: "TX", licenseNumber: "TX-123" });
    expect((await m.vendors.compliance(vendors.brand, "TX")).issues).toEqual(["No W-9 on file"]);
    expect((await m.vendors.compliance(vendors.lone)).issues).toContain("COI expired 2020-01-01");
    expect((await m.vendors.compliance(vendors.bad)).canInvite).toBe(false);
  });

  it("invites vendors by email with personal links, skips do-not-use, and never invites twice", async () => {
    const res = await m.rfps.inviteVendors(seanA, number, [vendors.brand, vendors.lone, vendors.bad], null);
    expect(res.map((r: any) => r.status)).toEqual(["sent to local outbox", "sent to local outbox", "skipped: do-not-use"]);
    links.brand = res[0].link; links.lone = res[1].link;
    expect(links.brand).toMatch(/^https:\/\/cpp\.example\/portal\/[A-Za-z0-9_-]{43}$/);
    const out = readdirSync(join(root, "outbox"));
    expect(out).toHaveLength(2);
    const mail = readFileSync(join(root, "outbox", out.find((f) => f.includes("dana"))!), "utf8");
    expect(mail).toContain("Subject: RFP-TUS-001 · Invitation to bid");
    expect(mail).toContain("TUS-30-001_RFP_GIT_");
    expect(mail).toContain(links.brand);
    const stored = await m.db.query(`select magic_link_hash from invitation`);
    expect(stored.every((s: any) => s.magic_link_hash.length === 64 && !links.brand.endsWith(s.magic_link_hash))).toBe(true);
    const again = await m.rfps.inviteVendors(seanA, number, [vendors.brand], null);
    expect(again[0].status).toBe("already invited");
  });

  it("lets a vendor use the portal: view, decline needs a reason, ask, bid, rebid", async () => {
    const tok = (l: string) => l.split("/").pop()!;
    const view = await m.rfps.portalView(tok(links.brand));
    expect(view.invitation.vendor_name).toBe("Brandpoint Roofing, LLC");
    expect(view.lines).toHaveLength(6);
    await expect(m.rfps.portalView("not-a-real-token")).rejects.toThrow(/isn't valid/);
    await expect(m.rfps.portalSetIntent(tok(links.lone), "declined")).rejects.toThrow(/why/);
    await m.rfps.portalSetIntent(tok(links.lone), "declined", "Crew booked through March");
    await m.rfps.portalAsk(tok(links.brand), "Are permits by owner or contractor?");
    const qs = (await m.rfps.rfpDetail(seanA, number)).questions;
    await m.rfps.answerQuestion(seanA, qs[0].id, "Contractor pulls and pays for permits.");
    expect((await m.rfps.portalView(tok(links.lone))).questions[0].answer).toContain("Contractor pulls");

    const L = Object.fromEntries(view.lines.map((l: any) => [l.line_no, l.id]));
    await expect(m.rfps.portalSubmitBid(tok(links.brand), { lines: [{ lineId: L["1"], unitPrice: null, amount: 5000, included: true }] })).rejects.toThrow(/Missing lines/);
    const lines = [
      { lineId: L["1"], unitPrice: null, amount: 5000, included: true },
      { lineId: L["2"], unitPrice: null, amount: 300000, included: true },
      { lineId: L["3"], unitPrice: 6.5, amount: null, included: true },
      { lineId: L["4"], unitPrice: null, amount: 12000, included: true },
      { lineId: L["5"], unitPrice: null, amount: 3500, included: true },
      { lineId: L["A1"], unitPrice: null, amount: 9000, included: true },
    ];
    const b1 = await m.rfps.portalSubmitBid(tok(links.brand), { lines, scheduleDays: 45, warrantyYears: 2 });
    expect(b1).toMatchObject({ version: 1, totalBase: 320500, late: false });
    const b2 = await m.rfps.portalSubmitBid(tok(links.brand), { lines: lines.map((l) => (l.lineId === L["2"] ? { ...l, amount: 295000 } : l)) });
    expect(b2).toMatchObject({ version: 2, totalBase: 315500 });
    const inv = (await m.rfps.rfpDetail(seanA, number)).invitations;
    expect(inv.find((i: any) => i.short_name === "BrandpointRoofing")).toMatchObject({ intent: "will_bid", bid_version: 2 });
    expect(inv.find((i: any) => i.short_name === "LoneStarRoofSystems")).toMatchObject({ intent: "declined", decline_reason: "Crew booked through March" });
  });

  it("holds a President step for Jeff until his account exists; no other executive can take it", async () => {
    const pid = (await m.db.query(`select id from project where project_code = $1`, [projectCode]))[0].id;
    await m.db.withTx(sean, (c: any) => m.approvals.requestApproval(c, { objectType: "award", objectId: pid, amount: 315500, projectId: pid, pmId: sean, requestedBy: sean, summary: "Award" }));
    const joeInbox = await m.approvals.myOpenApprovals(joe);
    const coo = joeInbox.find((a: any) => a.object_type === "award");
    await m.approvals.decide(joeA, { approvalId: coo.id, decision: "approved" });
    expect((await m.approvals.myOpenApprovals(joe)).some((a: any) => a.object_type === "award")).toBe(false);
    const waiting = await m.approvals.unassignedApprovals();
    expect(waiting).toHaveLength(1);
    await expect(m.approvals.decide(joeA, { approvalId: waiting[0].id, decision: "approved" })).rejects.toThrow(/doesn't have an account/);
    const jeff = (await m.people.addPerson(joeA, { email: "jeffg@gainesinvestmenttrust.com", displayName: "Jeff Gaines", roleCode: "executive", scopeKind: "all" })).userId;
    expect(await m.approvals.unassignedApprovals()).toHaveLength(0);
    const jeffInbox = await m.approvals.myOpenApprovals(jeff);
    expect(jeffInbox.map((a: any) => a.object_type)).toEqual(["award"]);
  });
});
