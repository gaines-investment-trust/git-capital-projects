/**
 * Integration tests against a real PostgreSQL database with all migrations applied.
 * Run with TEST_DATABASE_URL pointing at a throwaway database.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { Client } from "pg";

const url = process.env.TEST_DATABASE_URL;
const run = url ? describe : describe.skip;

run("sprint 1 against PostgreSQL", () => {
  let docRoot: string;
  let mod: {
    projects: typeof import("@/services/projects");
    filing: typeof import("@/services/filing");
    people: typeof import("@/services/people");
    approvals: typeof import("@/services/approvals");
    access: typeof import("@/lib/access");
    db: typeof import("@/lib/db");
  };
  let joe: string, sean: string, tus: string, lvd: string;

  beforeAll(async () => {
    // Fresh database
    const admin = new Client({ connectionString: url!.replace(/\/[^/]+$/, "/postgres") });
    await admin.connect();
    const name = url!.split("/").pop()!;
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.query(`create database ${name}`);
    await admin.end();
    execSync("node scripts/migrate.mjs", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });

    docRoot = mkdtempSync(join(tmpdir(), "gcp-sp-"));
    Object.assign(process.env, { DATABASE_URL: url, AUTH_SECRET: "test-secret-0123456789", DOCSTORE: "local", LOCAL_DOCSTORE_DIR: docRoot });
    mod = {
      projects: await import("@/services/projects"),
      filing: await import("@/services/filing"),
      people: await import("@/services/people"),
      approvals: await import("@/services/approvals"),
      access: await import("@/lib/access"),
      db: await import("@/lib/db"),
    };
    const { query } = mod.db;
    joe = (await query<{ id: string }>(`insert into app_user(email, display_name, kind) values ('joeg@gainesinvestmenttrust.com','Joe Gerber','employee') returning id`))[0].id;
    await query(`insert into user_role(user_id, role_id, scope_kind) select $1, id, 'all' from role where code in ('executive','admin')`, [joe]);
    tus = (await query<{ id: string }>(`insert into property(code, name, state, region_id) values ('TUS','Tuscany Square','TX',(select id from region where code='TX')) returning id`))[0].id;
    lvd = (await query<{ id: string }>(`insert into property(code, name, state, region_id) values ('LVD','Desert Vista','NV',(select id from region where code='NV')) returning id`))[0].id;
  });

  afterAll(async () => {
    await mod?.db.pool.end();
  });

  it("creates a project with ID, full folder tree, schedule, budget and audit trail", async () => {
    const actor = (await mod.access.loadActor(joe))!;
    const r = await mod.projects.createProject(actor, {
      propertyId: tus, projectTypeCode: "roof", name: "Building 1-8 roof replacement", managerUserId: joe,
      plannedStart: "2026-10-19", plannedEnd: "2027-01-29", budgetSource: "reserves", budgetAmount: "412000",
    });
    expect(r.code).toBe("TUS-26-001");
    expect(r.folderPath).toBe("TX/TUS - Tuscany Square/2026/TUS-26-001 - Building 1-8 roof replacement");
    const folders = readdirSync(join(docRoot, r.folderPath)).sort();
    expect(folders).toHaveLength(14);
    expect(folders.at(0)).toBe("01 Planning");
    expect(folders.at(-1)).toBe("14 Closeout");
    expect(existsSync(join(docRoot, r.folderPath, "02 RFP", "Issued"))).toBe(true);

    const second = await mod.projects.createProject(actor, {
      propertyId: tus, projectTypeCode: "interior", name: "Clubhouse refresh", managerUserId: joe, plannedStart: "2026-12-01", budgetSource: "capital_plan", budgetAmount: 150000,
    });
    expect(second.code).toBe("TUS-26-002");

    const view = await mod.projects.getProjectByCode(actor, r.code);
    expect(view!.schedule.map((t: any) => t.name)).toContain("Deck inspection");
    expect((view!.schedule.find((t: any) => t.name === "Deck inspection") as any)?.is_inspection_hold_point).toBe(true);
    expect(view!.budget.reduce((a: number, b: any) => a + Number(b.revised_budget), 0)).toBe(412000);

    const audit = await mod.db.query(`select action, object_type, actor_user_id from audit_log where object_type = 'project' and object_id = $1`, [r.id]);
    expect(audit.length).toBeGreaterThan(0);
    expect(audit[0].actor_user_id).toBe(joe);

    const rows = await mod.projects.portfolio(actor);
    expect(rows.map((x) => x.project_code)).toEqual(["TUS-26-001", "TUS-26-002"]);
  });

  it("files a document by the convention, bumps versions, never overwrites, and writes metadata", async () => {
    const actor = (await mod.access.loadActor(joe))!;
    const file = { originalName: "Brandpoint proposal FINAL.PDF", content: Buffer.from("%PDF-1.4 test"), contentType: "application/pdf", source: "email" as const };
    const cls = { projectCode: "TUS-26-001", docType: "Bid", party: "Brandpoint Roofing", docDate: "2026-11-20", confidence: 0.97 };
    const a = await mod.filing.fileDocument(actor, file, cls);
    const b = await mod.filing.fileDocument(actor, file, cls);
    expect(a).toMatchObject({ status: "filed", name: "TUS-26-001_Bid_BrandpointRoofing_2026-11-20_v1.pdf" });
    expect(b).toMatchObject({ status: "filed", name: "TUS-26-001_Bid_BrandpointRoofing_2026-11-20_v2.pdf" });
    expect(a.path).toContain("/03 Bids/BrandpointRoofing/");
    const meta = JSON.parse(readFileSync(join(docRoot, `${a.path}.meta.json`), "utf8"));
    expect(meta).toMatchObject({ ProjectID: "TUS-26-001", DocType: "Bid", Vendor: "BrandpointRoofing", OriginalFileName: "Brandpoint proposal FINAL.PDF" });
  });

  it("sends low-confidence or unidentified documents to the Unfiled queue", async () => {
    const file = { originalName: "IMG_4471.jpg", content: Buffer.from("jpg"), contentType: "image/jpeg", source: "email" as const };
    const low = await mod.filing.fileDocument(null, file, { projectCode: "TUS-26-001", docType: "Photo", party: "GIT", docDate: "2026-11-16", confidence: 0.71 });
    const none = await mod.filing.fileDocument(null, file, { projectCode: null, docType: null, party: "GIT", docDate: "2026-11-16", confidence: 0.95 });
    expect(low.status).toBe("unfiled");
    expect(none.status).toBe("unfiled");
    expect(low.path.startsWith("00 Portfolio/Unfiled/")).toBe(true);
    expect((await mod.filing.unfiledQueue()).length).toBe(2);
  });

  it("limits a property-scoped manager to their own properties", async () => {
    const joeActor = (await mod.access.loadActor(joe))!;
    const added = await mod.people.addPerson(joeActor, {
      email: "sean.hunter@gainesinvestmenttrust.com", displayName: "Sean Hunter", roleCode: "capex_pm", scopeKind: "property", scopeIds: [lvd], approvalLimit: 9999.99,
    });
    sean = added.userId;
    const s = (await mod.access.loadActor(sean))!;
    expect(s.can("project.create")).toBe(true);
    expect(s.can("people.manage")).toBe(false);
    expect(s.approvalLimit).toBe(9999.99);
    expect((await mod.projects.portfolio(s)).length).toBe(0);
    expect(await mod.projects.getProjectByCode(s, "TUS-26-001")).toBeNull();
    await expect(mod.projects.createProject(s, { propertyId: tus, projectTypeCode: "pool", name: "Pool leak", managerUserId: sean, budgetSource: "reserves", budgetAmount: 1 }))
      .rejects.toThrow(/access/);
    const own = await mod.projects.createProject(s, { propertyId: lvd, projectTypeCode: "pool", name: "Pool leak repair", managerUserId: sean, plannedStart: "2026-10-01", budgetSource: "reserves", budgetAmount: 48500 });
    expect(own.code).toBe("LVD-26-001");
    await expect(mod.people.addPerson(s, { email: "x@y.com", displayName: "X", roleCode: "viewer", scopeKind: "all" })).rejects.toThrow(/Not allowed/);
  });

  it("routes approvals to named people by the confirmed thresholds", async () => {
    const chain = await mod.approvals.approvalChain("pay_request", 77400, sean);
    expect(chain.map((c) => c.role)).toEqual(["capex_pm", "coo", "president"]);
    expect(chain[0].userId).toBe(sean);
    expect(chain[1].userId).toBe(joe);
    expect(chain[2].name).toBe("Jeff Gaines");
    expect((await mod.approvals.approvalChain("change_order", 8000, sean)).map((c) => c.role)).toEqual(["capex_pm"]);
  });

  it("deactivates a person and hands their open work to someone else", async () => {
    const joeActor = (await mod.access.loadActor(joe))!;
    await mod.db.query(`insert into task(title, assignee_user_id) values ('Review RFP', $1)`, [sean]);
    await mod.people.deactivatePerson(joeActor, sean, joe);
    expect(await mod.access.loadActor(sean)).toBeNull();
    const t = await mod.db.query(`select assignee_user_id from task where title = 'Review RFP'`);
    expect(t[0].assignee_user_id).toBe(joe);
  });
});
