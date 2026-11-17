import { z } from "zod";
import type { PoolClient } from "pg";
import { withTx, query, one } from "@/lib/db";
import { docStore } from "@/lib/docstore";
import { projectCode, projectFolderPath, PROJECT_SUBFOLDERS } from "@/lib/naming";
import { type Actor, assertCan, scopeFilterSql } from "@/lib/access";

export const NewProjectInput = z.object({
  propertyId: z.string().uuid(),
  projectTypeCode: z.string().min(1),
  name: z.string().trim().min(3).max(120),
  managerUserId: z.string().uuid(),
  plannedStart: z.string().date().optional(),
  plannedEnd: z.string().date().optional(),
  budgetSource: z.enum(["capital_plan", "reserves", "operating", "insurance", "loan_draw"]),
  budgetAmount: z.coerce.number().nonnegative(),
});
export type NewProjectInput = z.infer<typeof NewProjectInput>;

/** Atomically allocates the next number for a scope, e.g. project:TUS:26 -> 4. */
export async function nextNumber(c: PoolClient, scope: string): Promise<number> {
  const r = await c.query<{ last_n: number }>(
    `insert into number_counter(scope, last_n) values ($1, 1)
     on conflict (scope) do update set last_n = number_counter.last_n + 1
     returning last_n`,
    [scope],
  );
  return r.rows[0].last_n;
}

type ScheduleStep = { name: string; kind?: "task" | "milestone" | "phase"; days?: number; payment?: boolean; hold?: boolean };

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

/**
 * Creates a project (build prompt 7.2): ID, SharePoint folder tree, default schedule,
 * budget lines for the type's cost codes. Folder creation happens before commit so a
 * failure leaves no half-made project; folders are idempotent so a retry is safe.
 */
export async function createProject(actor: Actor, raw: unknown) {
  assertCan(actor, "project.create");
  const input = NewProjectInput.parse(raw);

  return withTx(actor.userId, async (c) => {
    const prop = (await c.query(`select id, code, name, state, region_id from property where id = $1`, [input.propertyId])).rows[0];
    if (!prop) throw new Error("Property not found");
    if (!actor.canAccessProperty(prop.id, prop.region_id)) throw new Error("You don't have access to this property");

    const type = (await c.query(`select * from project_type where code = $1 and is_active`, [input.projectTypeCode])).rows[0];
    if (!type) throw new Error("Unknown project type");
    const stage = (await c.query(`select id from stage where code = 'planning'`)).rows[0];

    const year = input.plannedStart ? new Date(input.plannedStart).getUTCFullYear() : new Date().getUTCFullYear();
    const n = await nextNumber(c, `project:${prop.code}:${year % 100}`);
    const code = projectCode(prop.code, year, n);

    const p = (
      await c.query(
        `insert into project (project_code, property_id, project_type_id, name, stage_id, manager_user_id,
                              planned_start, planned_end, budget_source, budget_amount, enabled_tools, last_activity_at, created_by, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now(), $12, $12) returning *`,
        [code, prop.id, type.id, input.name, stage.id, input.managerUserId, input.plannedStart ?? null, input.plannedEnd ?? null,
         input.budgetSource, input.budgetAmount, type.enabled_tools, actor.userId],
      )
    ).rows[0];

    await c.query(`insert into project_member(project_id, user_id, role_on_project) values ($1,$2,'manager') on conflict do nothing`, [p.id, input.managerUserId]);

    // Budget lines: the type's cost codes. The whole amount starts on the main trade line
    // (first code outside division 01); the PM splits it out to general conditions and contingency.
    const codes: string[] = type.default_cost_codes ?? [];
    const main = codes.find((x) => !x.startsWith("01-")) ?? codes[0];
    for (const code of codes) {
      await c.query(
        `insert into budget_line (project_id, cost_code_id, original_budget, yardi_gl_account, yardi_job_code)
         select $1, cc.id, $3, cc.yardi_gl_account, cc.yardi_job_cost_code from cost_code cc where cc.code = $2`,
        [p.id, code, code === main ? input.budgetAmount : 0],
      );
    }

    // Default schedule from the type template, laid end to end from the planned start.
    const steps: ScheduleStep[] = type.default_schedule ?? [];
    let cursor = input.plannedStart ? new Date(input.plannedStart) : new Date();
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const days = s.kind === "milestone" ? 0 : s.days ?? 5;
      const end = addDays(cursor, days);
      await c.query(
        `insert into schedule_task (project_id, name, kind, start_date, end_date, duration_days, is_payment_milestone, is_inspection_hold_point, sort_order)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [p.id, s.name, s.kind ?? "task", cursor.toISOString().slice(0, 10), end.toISOString().slice(0, 10), days, !!s.payment, !!s.hold, i],
      );
      cursor = addDays(end, days === 0 ? 0 : 1);
    }

    // SharePoint folder tree (section 6.2).
    const folder = projectFolderPath({
      state: prop.state, propertyCode: prop.code, propertyName: prop.name, year, projectId: code, projectName: input.name,
    });
    const store = docStore();
    const root = await store.ensureFolder(folder);
    for (const sub of PROJECT_SUBFOLDERS) await store.ensureFolder(`${folder}/${sub}`);
    await c.query(`update project set sp_folder_item_id = $2 where id = $1`, [p.id, root.itemId]);
    await c.query(`insert into decision_log(project_id, decision, rationale, decided_by) values ($1, $2, $3, $4)`, [
      p.id, `Project ${code} created`, `Type ${type.name}; budget $${input.budgetAmount.toLocaleString("en-US")} from ${input.budgetSource}`, actor.userId,
    ]);

    return { id: p.id as string, code, folderPath: folder, folderItemId: root.itemId };
  });
}

export type PortfolioRow = {
  id: string; project_code: string; name: string; property_code: string; property_name: string; state: string;
  type_name: string; stage_name: string; stage_order: number; manager: string; health: string;
  budget: string; committed: string; invoiced: string; paid: string; forecast: string;
  planned_start: string | null; planned_end: string | null;
};

/** Portfolio table (7.1). Money comes from v_budget_line, never typed. Scoped to what the user may see. */
export async function portfolio(actor: Actor): Promise<PortfolioRow[]> {
  const { sql, params } = scopeFilterSql(actor, "pr");
  return query<PortfolioRow>(
    `select p.id, p.project_code, p.name, pr.code property_code, pr.name property_name, pr.state,
            t.name type_name, s.name stage_name, s.sort_order stage_order, u.display_name manager, p.health,
            coalesce(sum(b.revised_budget), p.budget_amount, 0) budget, coalesce(sum(b.committed),0) committed,
            coalesce(sum(b.invoiced),0) invoiced, coalesce(sum(b.paid),0) paid, coalesce(sum(b.forecast), p.budget_amount, 0) forecast,
            p.planned_start, p.planned_end
       from project p
       join property pr on pr.id = p.property_id
       join project_type t on t.id = p.project_type_id
       join stage s on s.id = p.stage_id
       join app_user u on u.id = p.manager_user_id
       left join v_budget_line b on b.project_id = p.id
      where p.status = 'active' and ${sql}
      group by p.id, pr.id, t.id, s.id, u.id
      order by s.sort_order, p.project_code`,
    params,
  );
}

export async function getProjectByCode(actor: Actor, code: string) {
  const p = await one<any>(
    `select p.*, pr.code property_code, pr.name property_name, pr.state, pr.region_id, t.name type_name, t.code type_code,
            s.name stage_name, u.display_name manager
       from project p join property pr on pr.id = p.property_id join project_type t on t.id = p.project_type_id
       join stage s on s.id = p.stage_id join app_user u on u.id = p.manager_user_id
      where p.project_code = $1`,
    [code],
  );
  if (!p || !actor.canAccessProperty(p.property_id, p.region_id)) return null;
  const [budget, schedule, decisions, documents] = await Promise.all([
    query(`select b.*, cc.code, cc.name cost_name from v_budget_line b join cost_code cc on cc.id = b.cost_code_id where b.project_id = $1 order by cc.code`, [p.id]),
    query(`select * from schedule_task where project_id = $1 order by sort_order`, [p.id]),
    query(`select d.*, u.display_name by_name from decision_log d left join app_user u on u.id = d.decided_by where project_id = $1 order by decided_at desc limit 20`, [p.id]),
    query(`select * from document where project_id = $1 order by created_at desc limit 50`, [p.id]),
  ]);
  return { project: p, budget, schedule, decisions, documents };
}
