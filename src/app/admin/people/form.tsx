"use client";
import { useActionState, useState, useTransition } from "react";
import { addPersonAction, directorySearchAction, type FormState } from "../../actions";

type Opt = { id: string; code: string; name: string };
type Hit = { entraObjectId: string; displayName: string; email: string; jobTitle: string | null; department: string | null; office: string | null };

const ROLES = [
  ["capex_pm", "Capital Project Manager"], ["operations", "Regional / Property Operations"], ["finance", "Finance"],
  ["contracts_admin", "Contracts Administrator"], ["design_lead", "Design Lead"], ["viewer", "Viewer"], ["admin", "Admin"], ["executive", "Executive"],
];
const DEFAULT_LIMIT: Record<string, string> = { capex_pm: "9999.99", executive: "" };

export function AddPersonForm({ properties, regions }: { properties: Opt[]; regions: Opt[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addPersonAction, undefined);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [pick, setPick] = useState<Hit | null>(null);
  const [role, setRole] = useState("capex_pm");
  const [scope, setScope] = useState("property");
  const [busy, start] = useTransition();

  const search = () =>
    start(async () => {
      const r = await directorySearchAction(q);
      setSearchErr(r.error ?? null);
      setHits(r.results);
    });

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h2 style={{ margin: 0 }}>Add people</h2>
      <div className="row">
        <label className="f" style={{ flex: "1 1 260px" }}>Search Microsoft 365 by name or email
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }} />
        </label>
        <button type="button" className="btn" onClick={search} disabled={busy || q.length < 2} style={{ alignSelf: "flex-end" }}>{busy ? "Searching…" : "Search"}</button>
      </div>
      {searchErr && <div className="notice err">{searchErr}</div>}
      {hits.length > 0 && (
        <table><tbody>{hits.map((h) => (
          <tr key={h.entraObjectId}><td><b>{h.displayName}</b><div className="small muted">{h.jobTitle} · {h.department} · {h.office}</div></td><td>{h.email}</td>
            <td><button type="button" className="btn" onClick={() => setPick(h)}>{pick?.entraObjectId === h.entraObjectId ? "Selected" : "Select"}</button></td></tr>
        ))}</tbody></table>
      )}
      <form action={action} className="grid" style={{ alignItems: "end" }}>
        <input type="hidden" name="entraObjectId" value={pick?.entraObjectId ?? ""} />
        <input type="hidden" name="jobTitle" value={pick?.jobTitle ?? ""} />
        <input type="hidden" name="department" value={pick?.department ?? ""} />
        <input type="hidden" name="office" value={pick?.office ?? ""} />
        <label className="f">Name<input key={`n-${pick?.entraObjectId ?? "manual"}`} name="displayName" required defaultValue={pick?.displayName ?? ""} readOnly={!!pick} /></label>
        <label className="f">Email<input key={`e-${pick?.entraObjectId ?? "manual"}`} name="email" type="email" required defaultValue={pick?.email ?? ""} readOnly={!!pick} /></label>
        <label className="f">Role<select name="roleCode" value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="f">Scope<select name="scopeKind" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="all">All properties</option><option value="region">Region</option><option value="property">Specific properties</option></select></label>
        {scope === "region" && <label className="f">Regions<select name="scopeIds" multiple size={5}>{regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
        {scope === "property" && <label className="f">Properties<select name="scopeIds" multiple size={6}>{properties.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></label>}
        <label className="f">Approval limit (USD, blank = none)<input name="approvalLimit" type="number" min="0" step="0.01" key={role} defaultValue={DEFAULT_LIMIT[role] ?? ""} /></label>
        <div className="row">
          <button className="btn primary" disabled={pending}>Add person</button>
          {state?.ok && <span className="notice ok">{state.ok}</span>}
          {state?.error && <span className="notice err">{state.error}</span>}
        </div>
      </form>
    </div>
  );
}
