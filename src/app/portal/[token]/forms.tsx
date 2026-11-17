"use client";
import { useActionState, useMemo, useState } from "react";
import { intentAction, askAction, bidAction, type PortalState } from "../actions";

const Msg = ({ s }: { s: PortalState }) => (s?.ok ? <span className="notice ok">{s.ok}</span> : s?.error ? <span className="notice err">{s.error}</span> : null);

export function IntentForm({ token, intent }: { token: string; intent: string | null }) {
  const [s, action, pending] = useActionState<PortalState, FormData>(intentAction, undefined);
  const [declining, setDeclining] = useState(false);
  return (
    <form action={action} className="row">
      <input type="hidden" name="token" value={token} />
      {intent && <span className={`pill ${intent === "will_bid" ? "ok" : "late"}`}>{intent === "will_bid" ? "You said you'll bid" : "You declined"}</span>}
      {!declining ? (
        <>
          <button className="btn primary" name="intent" value="will_bid" disabled={pending}>Yes, we'll bid</button>
          <button type="button" className="btn" onClick={() => setDeclining(true)}>Decline</button>
        </>
      ) : (
        <>
          <input name="reason" required placeholder="Reason for declining" style={{ flex: "1 1 260px", font: "inherit", border: "1px solid #C9D1DC", borderRadius: 8, padding: "9px 10px" }} />
          <button className="btn" name="intent" value="declined" disabled={pending}>Send</button>
        </>
      )}
      <Msg s={s} />
    </form>
  );
}

export function AskForm({ token }: { token: string }) {
  const [s, action, pending] = useActionState<PortalState, FormData>(askAction, undefined);
  return (
    <form action={action} className="row" style={{ marginTop: 10 }}>
      <input type="hidden" name="token" value={token} />
      <label className="f" style={{ flex: "1 1 300px" }}>Ask a question<textarea name="question" rows={2} required minLength={5} /></label>
      <button className="btn" disabled={pending} style={{ alignSelf: "flex-end" }}>Send question</button>
      <Msg s={s} />
    </form>
  );
}

type L = { id: string; line_no: string; description: string; quantity: number | null; unit: string; kind: string; unitPrice: number | null; amount: number | null; excluded: boolean };

export function BidForm({ token, lines, scheduleDays, warrantyYears, exclusions }: { token: string; lines: L[]; scheduleDays: number | null; warrantyYears: number | null; exclusions: string }) {
  const [s, action, pending] = useActionState<PortalState, FormData>(bidAction, undefined);
  const [vals, setVals] = useState(() => Object.fromEntries(lines.map((l) => [l.id, { u: l.unitPrice?.toString() ?? "", a: l.amount?.toString() ?? "", x: l.excluded }])));
  const total = useMemo(() => lines.filter((l) => l.kind === "base").reduce((sum, l) => {
    const v = vals[l.id];
    if (v.x) return sum;
    const a = v.a !== "" ? Number(v.a) : v.u !== "" && l.quantity !== null ? Number(v.u) * l.quantity : 0;
    return sum + (Number.isFinite(a) ? a : 0);
  }, 0), [vals, lines]);
  const set = (id: string, k: "u" | "a" | "x", val: string | boolean) => setVals({ ...vals, [id]: { ...vals[id], [k]: val } });
  const box = { font: "inherit", border: "1px solid #C9D1DC", borderRadius: 6, padding: "6px 8px", width: 110, textAlign: "right" as const };
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <input type="hidden" name="token" value={token} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {lines.map((l) => (
          <div key={l.id} style={{ border: "1px solid #E1E5EB", borderRadius: 10, padding: "10px 12px", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", background: vals[l.id].x ? "#F8F9FB" : "#fff" }}>
            <input type="hidden" name="lineId" value={l.id} />
            <div style={{ flex: "1 1 260px", minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{l.line_no}. {l.description}</div>
              <div className="small muted">{l.quantity !== null ? `${l.quantity} ${l.unit}` : `Your quantity · ${l.unit}`}{l.kind !== "base" ? ` · ${l.kind.replace("_", " ")}` : ""}</div>
            </div>
            <label className="f" style={{ fontWeight: 500, fontSize: 12 }}>Unit price
              <input name={`unit_${l.id}`} type="number" step="0.01" min="0" inputMode="decimal" value={vals[l.id].u} onChange={(e) => set(l.id, "u", e.target.value)} style={box} aria-label={`Unit price line ${l.line_no}`} disabled={vals[l.id].x} /></label>
            <label className="f" style={{ fontWeight: 500, fontSize: 12 }}>Amount
              <input name={`amount_${l.id}`} type="number" step="0.01" min="0" inputMode="decimal" value={vals[l.id].a} onChange={(e) => set(l.id, "a", e.target.value)} style={box}
                placeholder={l.quantity !== null && vals[l.id].u ? (Number(vals[l.id].u) * l.quantity).toFixed(2) : ""} aria-label={`Amount line ${l.line_no}`} disabled={vals[l.id].x} /></label>
            <label className="row" style={{ fontSize: 13, minHeight: 40 }}><input name={`excl_${l.id}`} type="checkbox" checked={vals[l.id].x} onChange={(e) => set(l.id, "x", e.target.checked)} aria-label={`Exclude line ${l.line_no}`} style={{ width: 20, height: 20 }} /> Excluded</label>
          </div>
        ))}
      </div>
      <div style={{ fontWeight: 700 }}>Base bid total: {total.toLocaleString("en-US", { style: "currency", currency: "USD" })}</div>
      <div className="grid">
        <label className="f">Schedule (calendar days)<input name="scheduleDays" type="number" min="1" defaultValue={scheduleDays ?? ""} /></label>
        <label className="f">Labor warranty (years)<input name="warrantyYears" type="number" min="0" step="0.5" defaultValue={warrantyYears ?? ""} /></label>
        <label className="f" style={{ gridColumn: "1 / -1" }}>Exclusions and qualifications<textarea name="exclusions" rows={3} defaultValue={exclusions} /></label>
      </div>
      <div className="row"><button className="btn primary" disabled={pending}>{pending ? "Submitting…" : "Submit bid"}</button><Msg s={s} /></div>
      <div className="small muted">You can resubmit until the deadline; each submission is kept as a new version.</div>
    </form>
  );
}
