"use client";
import { useActionState } from "react";
import { gapAnalysisAction, sendClarificationAction, requestAwardAction, regretsAction, type FormState } from "../../../award-actions";

const Msg = ({ s }: { s: FormState }) => (s?.ok ? <span className="notice ok">{s.ok}</span> : s?.error ? <span className="notice err">{s.error}</span> : null);

export function GapButton({ number }: { number: string }) {
  const [s, action, pending] = useActionState<FormState, FormData>(gapAnalysisAction, undefined);
  return (
    <form action={action} className="row"><input type="hidden" name="number" value={number} />
      <button className="btn primary" disabled={pending}>{pending ? "Analysing…" : "Run gap analysis"}</button><Msg s={s} /></form>
  );
}

export function ClarificationForm({ number, vendorId, vendor, subject, body }: { number: string; vendorId: string; vendor: string; subject: string; body: string }) {
  const [s, action, pending] = useActionState<FormState, FormData>(sendClarificationAction, undefined);
  return (
    <details style={{ borderTop: "1px solid #EEF1F5", padding: "8px 0" }}>
      <summary><b>{vendor}</b></summary>
      <form action={action} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
        <input type="hidden" name="number" value={number} /><input type="hidden" name="vendorId" value={vendorId} />
        <label className="f">Subject<input name="subject" defaultValue={subject} /></label>
        <label className="f">Email<textarea name="body" rows={9} defaultValue={body} /></label>
        <div className="row"><button className="btn" disabled={pending}>Send from my Outlook</button><Msg s={s} /></div>
      </form>
    </details>
  );
}

export function AwardForm({ number, bidders, recommended, alternates }: { number: string; bidders: { invitationId: string; label: string }[]; recommended: string | null; alternates: { id: string; label: string; on: boolean }[] }) {
  const [s, action, pending] = useActionState<FormState, FormData>(requestAwardAction, undefined);
  return (
    <form action={action} className="grid" style={{ alignItems: "end" }}>
      <input type="hidden" name="number" value={number} />
      <label className="f">Award to<select name="invitationId" defaultValue={recommended ?? bidders[0]?.invitationId}>{bidders.map((b) => <option key={b.invitationId} value={b.invitationId}>{b.label}{b.invitationId === recommended ? " (lowest compliant)" : ""}</option>)}</select></label>
      {alternates.length > 0 && (
        <fieldset style={{ border: "1px solid #E1E5EB", borderRadius: 8, padding: "8px 12px" }}><legend className="small">Accept alternates</legend>
          {alternates.map((a) => <label key={a.id} className="row small"><input type="checkbox" name="alternates" value={a.id} defaultChecked={a.on} /> {a.label}</label>)}</fieldset>
      )}
      <label className="f" style={{ gridColumn: "1 / -1" }}>Award memo (why this bidder, risks, vendor history)<textarea name="memo" rows={3} required minLength={20} /></label>
      <div className="row"><button className="btn primary" disabled={pending}>Send award for approval</button><Msg s={s} /></div>
      <div className="small muted" style={{ gridColumn: "1 / -1" }}>Awards go to the COO and then the President. The winner's paperwork must be complete, and every base line priced.</div>
    </form>
  );
}

export function RegretsButton({ number }: { number: string }) {
  const [s, action, pending] = useActionState<FormState, FormData>(regretsAction, undefined);
  return <form action={action} className="row"><input type="hidden" name="number" value={number} /><button className="btn" disabled={pending}>Send regret letters</button><Msg s={s} /></form>;
}
