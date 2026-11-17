import { z } from "zod";
import { withTx } from "@/lib/db";
import { type Actor, assertCan } from "@/lib/access";

const LineEdit = z.object({ lineId: z.string().uuid(), originalBudget: z.coerce.number().nonnegative(), forecastNote: z.string().trim().optional() });

/**
 * Original budget can be split across cost codes until the contract stage. After that,
 * money moves only through change orders and contingency draws (build prompt 7.3, 9.2),
 * so the budget history stays traceable.
 */
export async function setOriginalBudget(actor: Actor, raw: unknown) {
  assertCan(actor, "project.edit");
  const i = LineEdit.parse(raw);
  return withTx(actor.userId, async (c) => {
    const l = (await c.query(
      `select b.*, p.property_id, pr.region_id, s.sort_order stage_order, s.name stage_name
         from budget_line b join project p on p.id = b.project_id join property pr on pr.id = p.property_id join stage s on s.id = p.stage_id
        where b.id = $1 for update of b`,
      [i.lineId],
    )).rows[0];
    if (!l) throw new Error("Budget line not found");
    if (!actor.canAccessProperty(l.property_id, l.region_id)) throw new Error("You don't have access to this project");
    if (l.stage_order >= 5) throw new Error(`The project is at ${l.stage_name}: change the budget with a change order or a contingency draw`);
    await c.query(`update budget_line set original_budget = $2, forecast_note = coalesce($3, forecast_note) where id = $1`, [i.lineId, i.originalBudget, i.forecastNote || null]);
    const total = (await c.query(`select sum(original_budget) t from budget_line where project_id = $1`, [l.project_id])).rows[0].t;
    await c.query(`update project set budget_amount = $2, last_activity_at = now() where id = $1`, [l.project_id, total]);
    return { projectTotal: Number(total) };
  });
}
