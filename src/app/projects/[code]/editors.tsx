"use client";
import { useActionState, useState } from "react";
import { updateTaskAction, setBudgetAction, type FormState } from "../../actions";

const fmt = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");

export type TaskRow = {
  id: string; name: string; kind: string; start_date: string; end_date: string; baseline_end: string | null;
  percent_complete: string; is_payment_milestone: boolean; is_inspection_hold_point: boolean;
};

function TaskEditor({ t, projectCode, canEdit }: { t: TaskRow; projectCode: string; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [end, setEnd] = useState(t.end_date);
  const [state, action, pending] = useActionState<FormState, FormData>(updateTaskAction, undefined);
  const slip = Math.round((Date.parse(end) - Date.parse(t.end_date)) / 86400000);
  const vsBaseline = t.baseline_end ? Math.round((Date.parse(t.end_date) - Date.parse(t.baseline_end)) / 86400000) : null;
  return (
    <>
      <tr>
        <td>{t.kind === "milestone" ? "◆ " : ""}{t.name}</td>
        <td>{fmt(t.start_date)}</td>
        <td>{fmt(t.end_date)}{vsBaseline !== null && vsBaseline > 0 && <span className="pill at_risk" style={{ marginLeft: 6 }}>+{vsBaseline}d</span>}</td>
        <td className="small">{[t.is_payment_milestone && "payment milestone", t.is_inspection_hold_point && "inspection hold point"].filter(Boolean).join(" · ")}</td>
        <td className="num">{Number(t.percent_complete)}%</td>
        <td>{canEdit && <button type="button" className="btn" onClick={() => setOpen(!open)}>{open ? "Close" : "Update"}</button>}</td>
      </tr>
      {open && (
        <tr><td colSpan={6} style={{ background: "#F8F9FB" }}>
          <form action={action} className="grid" style={{ alignItems: "end" }}>
            <input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="projectCode" value={projectCode} />
            <label className="f">Start<input type="date" name="startDate" defaultValue={t.start_date} required /></label>
            <label className="f">End<input type="date" name="endDate" value={end} onChange={(e) => setEnd(e.target.value)} required /></label>
            <label className="f">% complete<input type="number" name="percentComplete" min={0} max={100} defaultValue={Number(t.percent_complete)} /></label>
            {slip > 0 && <label className="f">Reason for the {slip}-day slip (required, logged)<input name="reason" required placeholder="e.g. Rain Nov 4–5; deck rot at Bldg 3" /></label>}
            <div className="row">
              <button className="btn primary" disabled={pending}>Save</button>
              {state?.ok && <span className="notice ok">{state.ok}</span>}
              {state?.error && <span className="notice err">{state.error}</span>}
            </div>
          </form>
        </td></tr>
      )}
    </>
  );
}

export function ScheduleTable({ tasks, projectCode, canEdit }: { tasks: TaskRow[]; projectCode: string; canEdit: boolean }) {
  return (
    <div className="scroll"><table>
      <thead><tr><th>Task</th><th>Start</th><th>End</th><th>Flags</th><th className="num">% done</th><th></th></tr></thead>
      <tbody>{tasks.map((t) => <TaskEditor key={t.id} t={t} projectCode={projectCode} canEdit={canEdit} />)}</tbody>
    </table></div>
  );
}

export function BudgetCell({ lineId, value, projectCode }: { lineId: string; value: number; projectCode: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setBudgetAction, undefined);
  return (
    <form action={action} style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
      <input type="hidden" name="lineId" value={lineId} /><input type="hidden" name="projectCode" value={projectCode} />
      <input name="originalBudget" type="number" min={0} step={1} defaultValue={value} aria-label="Original budget"
        style={{ width: 120, textAlign: "right", font: "inherit", border: "1px solid #C9D1DC", borderRadius: 6, padding: "6px 8px" }} />
      <button className="btn" disabled={pending} style={{ minHeight: 32 }}>Save</button>
      {state?.error && <span className="small" style={{ color: "#A3271B" }}>{state.error}</span>}
    </form>
  );
}
