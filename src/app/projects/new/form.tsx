"use client";
import { useActionState } from "react";
import { createProjectAction, type FormState } from "../../actions";

type Opt = { id?: string; code?: string; name?: string; state?: string; display_name?: string };

export function NewProjectForm({ properties, types, managers, me }: { properties: Opt[]; types: Opt[]; managers: Opt[]; me: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createProjectAction, undefined);
  return (
    <form action={action} className="card grid">
      <label className="f">Property
        <select name="propertyId" required>{properties.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name} ({p.state})</option>)}</select>
      </label>
      <label className="f">Project type
        <select name="projectTypeCode" required>{types.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select>
      </label>
      <label className="f">Project name<input name="name" required minLength={3} maxLength={120} placeholder="e.g. Building 1-8 roof replacement" /></label>
      <label className="f">Project manager
        <select name="managerUserId" defaultValue={managers.some((m) => m.id === me) ? me : managers[0]?.id}>{managers.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</select>
      </label>
      <label className="f">Target start<input name="plannedStart" type="date" /></label>
      <label className="f">Target end<input name="plannedEnd" type="date" /></label>
      <label className="f">Budget source
        <select name="budgetSource" defaultValue="reserves">
          <option value="capital_plan">Capital plan</option><option value="reserves">Reserves</option><option value="operating">Operating</option>
          <option value="insurance">Insurance</option><option value="loan_draw">Loan draw</option>
        </select>
      </label>
      <label className="f">Budget amount (USD)<input name="budgetAmount" type="number" min="0" step="1" required /></label>
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn primary" disabled={pending}>{pending ? "Creating project and folders…" : "Create project"}</button>
        {state?.error && <div className="notice err">{state.error}</div>}
      </div>
    </form>
  );
}
