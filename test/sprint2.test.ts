import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { Client } from "pg";
import ExcelJS from "exceljs";

const base = process.env.TEST_DATABASE_URL;
const url = base ? `${base}_s2` : undefined;
const run = url ? describe : describe.skip;

run("sprint 2: schedules, budgets, Excel", () => {
  let m: any;
  let actor: any, projectId: string, code: string;

  beforeAll(async () => {
    const admin = new Client({ connectionString: url!.replace(/\/[^/]+$/, "/postgres") });
    await admin.connect();
    const name = url!.split("/").pop()!;
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.query(`create database ${name}`);
    await admin.end();
    execSync("node scripts/migrate.mjs", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    Object.assign(process.env, { DATABASE_URL: url, AUTH_SECRET: "test-secret-0123456789", DOCSTORE: "local", LOCAL_DOCSTORE_DIR: mkdtempSync(join(tmpdir(), "gcp2-")) });
    m = {
      db: await import("@/lib/db"), access: await import("@/lib/access"), projects: await import("@/services/projects"),
      schedule: await import("@/services/schedule"), budget: await import("@/services/budget"), excel: await import("@/lib/excel"),
    };
    const joe = (await m.db.query(`insert into app_user(email, display_name, kind) values ('joeg@gainesinvestmenttrust.com','Joe Gerber','employee') returning id`))[0].id;
    await m.db.query(`insert into user_role(user_id, role_id, scope_kind) select $1, id, 'all' from role where code in ('executive','admin')`, [joe]);
    const prop = (await m.db.query(`insert into property(code, name, state) values ('TUS','Tuscany Square','TX') returning id`))[0].id;
    actor = await m.access.loadActor(joe);
    const r = await m.projects.createProject(actor, {
      propertyId: prop, projectTypeCode: "roof", name: "Roof", managerUserId: joe, plannedStart: "2030-01-07", budgetSource: "reserves", budgetAmount: 412000,
    });
    projectId = r.id; code = r.code;
  });
  afterAll(async () => { await m?.db.pool.end(); });

  const task = async (name: string) => (await m.db.query(`select * from schedule_task where project_id = $1 and name = $2`, [projectId, name]))[0];

  it("puts the whole budget on the trade cost code, not general conditions", async () => {
    const v = await m.projects.getProjectByCode(actor, code);
    const roofing = v.budget.find((b: any) => b.code === "07-310");
    expect(Number(roofing.original_budget)).toBe(412000);
    expect(Number(v.budget.find((b: any) => b.code === "01-100").original_budget)).toBe(0);
  });

  it("keeps dates exactly as entered (no timezone shift)", async () => {
    const first = (await m.db.query(`select start_date from schedule_task where project_id = $1 order by sort_order limit 1`, [projectId]))[0];
    expect(first.start_date).toBe("2030-01-07");
  });

  it("requires and logs a reason for any slip, and flags the project at risk against the baseline", async () => {
    await m.schedule.saveBaseline(actor, projectId);
    const t = await task("Tear-off and install");
    const later = new Date(Date.parse(t.end_date) + 5 * 86400000).toISOString().slice(0, 10);
    await expect(m.schedule.updateTask(actor, { taskId: t.id, startDate: t.start_date, endDate: later, percentComplete: 10 })).rejects.toThrow(/5 days later/);
    const r = await m.schedule.updateTask(actor, { taskId: t.id, startDate: t.start_date, endDate: later, percentComplete: 10, reason: "Rain Jan 20-24" });
    expect(r.slipDays).toBe(5);
    expect(r.movedTasks).toBeGreaterThan(0);
    const deck = await task("Deck inspection");
    expect(deck.start_date > later).toBe(true); // inspection now follows the work it inspects
    const all = await m.db.query(`select name, start_date, end_date, kind from schedule_task where project_id = $1 order by sort_order`, [projectId]);
    for (let k = 1; k < all.length; k++) expect(all[k].start_date >= all[k - 1].end_date).toBe(true);
    const changes = await m.schedule.scheduleChanges(projectId);
    expect(changes.find((c: any) => c.reason === "Rain Jan 20-24")).toMatchObject({ old_end: t.end_date, new_end: later });
    expect(changes.some((c: any) => c.reason.startsWith("Moved") && c.reason.endsWith("Tear-off and install"))).toBe(true);
    const p = (await m.db.query(`select health, planned_end from project where id = $1`, [projectId]))[0];
    expect(p.health).toBe("at_risk");
  });

  it("marks a project late when an unfinished task's end date has passed", async () => {
    const t = await task("Punch list");
    await m.schedule.updateTask(actor, { taskId: t.id, startDate: "2020-01-01", endDate: "2020-01-02", percentComplete: 50, reason: "test" });
    expect((await m.db.query(`select health from project where id = $1`, [projectId]))[0].health).toBe("late");
    await m.schedule.updateTask(actor, { taskId: t.id, startDate: "2020-01-01", endDate: "2020-01-02", percentComplete: 100 });
    expect((await m.db.query(`select health from project where id = $1`, [projectId]))[0].health).toBe("at_risk");
  });

  it("lets the budget be split before contract, then locks it", async () => {
    const lines = await m.db.query(`select b.id, cc.code from budget_line b join cost_code cc on cc.id = b.cost_code_id where project_id = $1`, [projectId]);
    const id = (c: string) => lines.find((l: any) => l.code === c).id;
    await m.budget.setOriginalBudget(actor, { lineId: id("07-310"), originalBudget: 362000 });
    const r = await m.budget.setOriginalBudget(actor, { lineId: id("01-900"), originalBudget: 50000 });
    expect(r.projectTotal).toBe(412000);
    await m.db.query(`update project set stage_id = (select id from stage where code = 'contract') where id = $1`, [projectId]);
    await expect(m.budget.setOriginalBudget(actor, { lineId: id("01-900"), originalBudget: 1 })).rejects.toThrow(/change order/);
  });

  it("exports a real Excel workbook with numbers, not text", async () => {
    const v = await m.projects.getProjectByCode(actor, code);
    const buf = await m.excel.workbook("Budget", [{ header: "Cost code", key: "code" }, { header: "Original", key: "original_budget", money: true }], v.budget, "test");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet("Budget")!;
    expect(ws.getRow(4).getCell(1).value).toBe("Cost code");
    const values = [];
    for (let r = 5; r <= ws.rowCount; r++) values.push(ws.getRow(r).getCell(2).value);
    expect(values.every((x) => typeof x === "number")).toBe(true);
    expect((values as number[]).reduce((a, b) => a + b, 0)).toBe(412000);
  });
});
