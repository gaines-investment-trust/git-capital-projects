import { z } from "zod";
import { withTx, one } from "@/lib/db";
import { type Actor, assertCan } from "@/lib/access";

const TaskUpdate = z.object({
  taskId: z.string().uuid(),
  startDate: z.string().date(),
  endDate: z.string().date(),
  percentComplete: z.coerce.number().min(0).max(100),
  reason: z.string().trim().optional(),
});

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/**
 * Edit a schedule task (build prompt 7.4). Any slip past the task's current end date needs a
 * written reason, which is logged; after a baseline is set, slips are also measured against it.
 * Project health and dates are recalculated in the same transaction.
 */
export async function updateTask(actor: Actor, raw: unknown) {
  assertCan(actor, "project.edit");
  const i = TaskUpdate.parse(raw);
  if (i.endDate < i.startDate) throw new Error("End date is before start date");
  return withTx(actor.userId, async (c) => {
    const t = (await c.query(
      `select t.*, p.property_id, pr.region_id from schedule_task t join project p on p.id = t.project_id join property pr on pr.id = p.property_id where t.id = $1 for update of t`,
      [i.taskId],
    )).rows[0];
    if (!t) throw new Error("Task not found");
    if (!actor.canAccessProperty(t.property_id, t.region_id)) throw new Error("You don't have access to this project");

    const slip = t.end_date ? daysBetween(t.end_date, i.endDate) : 0;
    if (slip > 0 && !i.reason) throw new Error(`This moves the end date ${slip} day${slip === 1 ? "" : "s"} later. Give a reason; it is logged.`);
    if (t.end_date !== i.endDate) {
      await c.query(`insert into schedule_change (task_id, old_end, new_end, reason, created_by) values ($1,$2,$3,$4,$5)`, [
        i.taskId, t.end_date, i.endDate, i.reason || (slip < 0 ? "Pulled in" : "Date change"), actor.userId,
      ]);
    }
    await c.query(
      `update schedule_task set start_date = $2, end_date = $3, duration_days = $4, percent_complete = $5 where id = $1`,
      [i.taskId, i.startDate, i.endDate, Math.max(0, daysBetween(i.startDate, i.endDate)), i.percentComplete],
    );
    const moved = await pushSuccessors(c, i.taskId, t.name, actor.userId);
    await refreshProjectDatesAndHealth(c, t.project_id);
    return { slipDays: slip, movedTasks: moved };
  });
}

const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);

/**
 * Finish-to-start knock-on: a successor may not start before its predecessor ends (plus lag).
 * Successors that would overlap move later by the overlap, keeping their duration; each move is
 * logged with the cause. Successors are never pulled earlier automatically.
 */
async function pushSuccessors(c: { query: (s: string, p?: unknown[]) => Promise<any> }, taskId: string, taskName: string, userId: string): Promise<number> {
  let moved = 0;
  const queue: { id: string; name: string }[] = [{ id: taskId, name: taskName }];
  const seen = new Set<string>();
  while (queue.length) {
    const pred = queue.shift()!;
    if (seen.has(pred.id)) continue; // guards against accidental cycles
    seen.add(pred.id);
    const succs = (await c.query(
      `select s.id, s.name, s.start_date, s.end_date, s.kind, d.lag_days, p.end_date pred_end, p.kind pred_kind
         from task_dependency d join schedule_task s on s.id = d.successor_id join schedule_task p on p.id = d.predecessor_id
        where d.predecessor_id = $1 and d.kind = 'FS'`,
      [pred.id],
    )).rows;
    for (const x of succs) {
      // A task that takes days ends at close of its end date, so the successor starts the day after; milestones are same-day.
      const earliest = addDays(x.pred_end, (x.pred_kind === "milestone" ? 0 : 1) + Number(x.lag_days));
      if (x.start_date >= earliest) continue;
      const shift = Math.round((Date.parse(earliest) - Date.parse(x.start_date)) / 86400000);
      const newEnd = addDays(x.end_date, shift);
      await c.query(`update schedule_task set start_date = $2, end_date = $3 where id = $1`, [x.id, earliest, newEnd]);
      await c.query(`insert into schedule_change (task_id, old_end, new_end, reason, created_by) values ($1,$2,$3,$4,$5)`, [
        x.id, x.end_date, newEnd, `Moved ${shift} day${shift === 1 ? "" : "s"} by predecessor: ${pred.name}`, userId,
      ]);
      moved++;
      queue.push({ id: x.id, name: x.name });
    }
  }
  return moved;
}

/** Saves today's dates as the baseline (normally at contract award). */
export async function saveBaseline(actor: Actor, projectId: string) {
  assertCan(actor, "project.edit");
  return withTx(actor.userId, async (c) => {
    await c.query(`update schedule_task set baseline_start = start_date, baseline_end = end_date where project_id = $1`, [projectId]);
    await c.query(
      `update project set baseline_start = (select min(start_date) from schedule_task where project_id = $1),
                          baseline_end   = (select max(end_date)   from schedule_task where project_id = $1) where id = $1`,
      [projectId],
    );
    await c.query(`insert into decision_log(project_id, decision, rationale, decided_by) values ($1,'Schedule baseline saved',null,$2)`, [projectId, actor.userId]);
  });
}

/**
 * Health rules (section 11, "Task or milestone late"): late = an unfinished task's end date has passed;
 * at risk = any task is past its baseline; otherwise on track. Blocked is set by compliance rules.
 */
export async function refreshProjectDatesAndHealth(c: { query: (s: string, p?: unknown[]) => Promise<any> }, projectId: string) {
  await c.query(
    `update project p set
        planned_start = coalesce((select min(start_date) from schedule_task where project_id = p.id), p.planned_start),
        planned_end   = coalesce((select max(end_date)   from schedule_task where project_id = p.id), p.planned_end),
        last_activity_at = now(),
        health = case
          when p.health = 'blocked' then 'blocked'
          when exists (select 1 from schedule_task t where t.project_id = p.id and t.percent_complete < 100 and t.end_date < current_date) then 'late'
          when exists (select 1 from schedule_task t where t.project_id = p.id and t.baseline_end is not null and t.end_date > t.baseline_end) then 'at_risk'
          else 'on_track' end
      where p.id = $1`,
    [projectId],
  );
}

export async function scheduleChanges(projectId: string) {
  return (await one<{ rows: any[] }>(
    `select coalesce(json_agg(x order by x.created_at desc), '[]') rows from (
       select sc.*, t.name task_name, u.display_name by_name from schedule_change sc
       join schedule_task t on t.id = sc.task_id left join app_user u on u.id = sc.created_by
       where t.project_id = $1 order by sc.created_at desc limit 50) x`,
    [projectId],
  ))?.rows ?? [];
}
