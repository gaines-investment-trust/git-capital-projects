"use client";
import { useActionState, useState } from "react";
import {
  updateRfpAction, saveBidFormAction, submitRfpAction, issueRfpAction, inviteAction, answerAction, type FormState,
} from "../../rfp-actions";

function Result({ s }: { s: FormState }) {
  if (!s) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {s.ok && <span className="notice ok">{s.ok}</span>}
      {s.error && <span className="notice err">{s.error}</span>}
      {s.detail?.map((d) => <span key={d} className="small" style={{ wordBreak: "break-all" }}>{d}</span>)}
    </div>
  );
}

export function ScopeForm({ number, rfp, disabled }: { number: string; rfp: any; disabled: boolean }) {
  const [s, action, pending] = useActionState<FormState, FormData>(updateRfpAction, undefined);
  const sc = rfp.scope ?? {};
  return (
    <form action={action} className="grid">
      <input type="hidden" name="number" value={number} /><input type="hidden" name="part" value="scope" />
      <label className="f" style={{ gridColumn: "1 / -1" }}>Title<input name="title" defaultValue={rfp.title} disabled={disabled} /></label>
      <label className="f" style={{ gridColumn: "1 / -1" }}>Scope summary (plain words)<textarea name="summary" rows={3} defaultValue={sc.summary} disabled={disabled} /></label>
      <label className="f" style={{ gridColumn: "1 / -1" }}>Numbered scope items (one per line)<textarea name="items" rows={5} defaultValue={(sc.items ?? []).map((x: string, i: number) => `${i + 1}. ${x}`).join("\n")} disabled={disabled} /></label>
      <label className="f">Inclusions<textarea name="inclusions" rows={3} defaultValue={sc.inclusions} disabled={disabled} /></label>
      <label className="f">Exclusions bidders must declare<textarea name="exclusions" rows={3} defaultValue={sc.exclusions} disabled={disabled} /></label>
      <label className="f">Phasing<textarea name="phasing" rows={2} defaultValue={sc.phasing} disabled={disabled} /></label>
      <label className="f">Resident impact<textarea name="residentImpact" rows={2} defaultValue={sc.residentImpact} disabled={disabled} /></label>
      <label className="f" style={{ gridColumn: "1 / -1" }}>Cover note for the invitation email (optional)<textarea name="coverNote" rows={2} defaultValue={rfp.cover_note ?? ""} disabled={disabled} /></label>
      {!disabled && <div className="row"><button className="btn primary" disabled={pending}>Save scope</button><Result s={s} /></div>}
      <div className="small muted" style={{ gridColumn: "1 / -1" }}>Claude drafts a numbered scope from your notes and photos once the Claude API key is set up (deploy step).</div>
    </form>
  );
}

type Line = { line_no: string; description: string; quantity: string | null; unit: string; kind: string };

export function BidFormEditor({ number, lines, disabled }: { number: string; lines: Line[]; disabled: boolean }) {
  const [s, action, pending] = useActionState<FormState, FormData>(saveBidFormAction, undefined);
  const [rows, setRows] = useState<Line[]>(lines);
  const input = { font: "inherit", border: "1px solid #C9D1DC", borderRadius: 6, padding: "6px 8px", width: "100%", boxSizing: "border-box" as const };
  return (
    <form action={action}>
      <input type="hidden" name="number" value={number} />
      <div className="scroll"><table>
        <thead><tr><th style={{ width: 70 }}>#</th><th>Description</th><th style={{ width: 90 }}>Qty</th><th style={{ width: 80 }}>Unit</th><th style={{ width: 130 }}>Type</th>{!disabled && <th></th>}</tr></thead>
        <tbody>{rows.map((l, i) => (
          <tr key={i}>
            <td><input name="line_no" defaultValue={l.line_no} style={input} disabled={disabled} aria-label="Line number" /></td>
            <td><input name="description" defaultValue={l.description} style={input} disabled={disabled} aria-label="Description" /></td>
            <td><input name="quantity" type="number" step="any" min="0" defaultValue={l.quantity === null ? "" : Number(l.quantity)} style={input} disabled={disabled} aria-label="Quantity" /></td>
            <td><input name="unit" defaultValue={l.unit} style={input} disabled={disabled} aria-label="Unit" /></td>
            <td><select name="kind" defaultValue={l.kind} style={input} disabled={disabled} aria-label="Type">
              <option value="base">Base</option><option value="alternate">Alternate</option><option value="unit_price">Unit price</option><option value="allowance">Allowance</option></select></td>
            {!disabled && <td><button type="button" className="btn" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Remove line ${l.line_no}`}>Remove</button></td>}
          </tr>
        ))}</tbody>
      </table></div>
      {!disabled && (
        <div className="row" style={{ marginTop: 10 }}>
          <button type="button" className="btn" onClick={() => setRows([...rows, { line_no: String(rows.length + 1), description: "", quantity: null, unit: "LS", kind: "base" }])}>Add line</button>
          <button className="btn primary" disabled={pending}>Save bid form</button>
          <Result s={s} />
        </div>
      )}
    </form>
  );
}

export function DatesForm({ number, v, disabled }: { number: string; v: Record<string, string>; disabled: boolean }) {
  const [s, action, pending] = useActionState<FormState, FormData>(updateRfpAction, undefined);
  return (
    <form action={action} className="grid" style={{ alignItems: "end" }}>
      <input type="hidden" name="number" value={number} /><input type="hidden" name="part" value="dates" />
      <label className="f">Site walk (Pacific)<input type="datetime-local" name="siteWalkAt" defaultValue={v.siteWalkAt} disabled={disabled} /></label>
      <label className="f">Questions due (Pacific)<input type="datetime-local" name="questionsDueAt" defaultValue={v.questionsDueAt} disabled={disabled} /></label>
      <label className="f">Bids due (Pacific)<input type="datetime-local" name="bidDueAt" defaultValue={v.bidDueAt} disabled={disabled} required /></label>
      <label className="f">Target award<input type="date" name="targetAwardDate" defaultValue={v.targetAwardDate} disabled={disabled} /></label>
      <label className="f">Target start<input type="date" name="targetStartDate" defaultValue={v.targetStartDate} disabled={disabled} /></label>
      {!disabled && <div className="row"><button className="btn primary" disabled={pending}>Save dates</button><Result s={s} /></div>}
    </form>
  );
}

export function RequirementsForm({ number, r, disabled }: { number: string; r: any; disabled: boolean }) {
  const [s, action, pending] = useActionState<FormState, FormData>(updateRfpAction, undefined);
  return (
    <form action={action} className="grid" style={{ alignItems: "end" }}>
      <input type="hidden" name="number" value={number} /><input type="hidden" name="part" value="requirements" />
      <label className="f">GL each occurrence ($)<input type="number" name="gl_each_occurrence" defaultValue={r.gl_each_occurrence ?? ""} disabled={disabled} /></label>
      <label className="f">GL aggregate ($)<input type="number" name="gl_aggregate" defaultValue={r.gl_aggregate ?? ""} disabled={disabled} /></label>
      <label className="f">Auto ($)<input type="number" name="auto" defaultValue={r.auto ?? ""} disabled={disabled} /></label>
      <label className="f">Umbrella ($)<input type="number" name="umbrella" defaultValue={r.umbrella ?? ""} disabled={disabled} /></label>
      <label className="f">Additional insured<input name="additional_insured" defaultValue={r.additional_insured ?? ""} disabled={disabled} /></label>
      <label className="f">Retainage (%)<input type="number" name="retainage_pct" defaultValue={r.retainage_pct ?? 10} disabled={disabled} /></label>
      <label className="f">Payment terms<input name="payment_terms" defaultValue={r.payment_terms ?? ""} disabled={disabled} /></label>
      <label className="row" style={{ fontSize: 13, fontWeight: 600 }}><input type="checkbox" name="prevailing_wage" defaultChecked={!!r.prevailing_wage} disabled={disabled} /> Prevailing wage applies</label>
      {!disabled && <div className="row"><button className="btn primary" disabled={pending}>Save requirements</button><Result s={s} /></div>}
    </form>
  );
}

export function SubmitButton({ number, blocked }: { number: string; blocked: boolean }) {
  const [s, action, pending] = useActionState<FormState, FormData>(submitRfpAction, undefined);
  return (
    <form action={action} className="row">
      <input type="hidden" name="number" value={number} />
      <button className="btn primary" disabled={pending || blocked}>Submit for approval</button>
      <Result s={s} />
    </form>
  );
}

export function IssueButton({ number }: { number: string }) {
  const [s, action, pending] = useActionState<FormState, FormData>(issueRfpAction, undefined);
  return (
    <form action={action} className="row">
      <input type="hidden" name="number" value={number} />
      <button className="btn primary" disabled={pending}>{pending ? "Generating and filing…" : "Issue RFP (Word + Excel bid form)"}</button>
      <Result s={s} />
    </form>
  );
}

type V = { id: string; name: string; trades: string[]; approved_status: string; coi_expires: string | null; invited: boolean; issues: string[]; canInvite: boolean };

export function InviteForm({ number, vendors }: { number: string; vendors: V[] }) {
  const [s, action, pending] = useActionState<FormState, FormData>(inviteAction, undefined);
  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <input type="hidden" name="number" value={number} />
      <div className="scroll"><table>
        <thead><tr><th></th><th>Vendor</th><th>Trades</th><th>Status</th><th>Paperwork</th></tr></thead>
        <tbody>{vendors.map((v) => (
          <tr key={v.id}>
            <td><input type="checkbox" name="vendorIds" value={v.id} disabled={v.invited || !v.canInvite} aria-label={`Invite ${v.name}`} /></td>
            <td><a href={`/vendors/${v.id}`}>{v.name}</a>{v.invited && <span className="pill ok" style={{ marginLeft: 6 }}>invited</span>}</td>
            <td className="small">{v.trades.join(", ")}</td>
            <td><span className={`pill ${v.approved_status === "do_not_use" ? "late" : v.approved_status === "probation" ? "risk" : v.approved_status === "pending" ? "" : "ok"}`}>{v.approved_status.replace(/_/g, " ")}</span></td>
            <td className="small">{v.issues.length ? v.issues.join(" · ") : "Complete"}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <div className="row"><button className="btn primary" disabled={pending}>{pending ? "Sending…" : "Send invitations from my Outlook"}</button><Result s={s} /></div>
      <div className="small muted">Vendors with missing paperwork can still be invited; awards and payments wait until it is complete. Do-not-use vendors can't be invited.</div>
    </form>
  );
}

export function AnswerForm({ number, questionId }: { number: string; questionId: string }) {
  const [s, action, pending] = useActionState<FormState, FormData>(answerAction, undefined);
  if (s?.ok) return <span className="notice ok">{s.ok}</span>;
  return (
    <form action={action} className="row">
      <input type="hidden" name="number" value={number} /><input type="hidden" name="questionId" value={questionId} />
      <input name="answer" required placeholder="Answer (published to all bidders)" style={{ flex: "1 1 300px", font: "inherit", border: "1px solid #C9D1DC", borderRadius: 8, padding: "8px 10px" }} />
      <button className="btn" disabled={pending}>Publish answer</button>
      {s?.error && <span className="notice err">{s.error}</span>}
    </form>
  );
}
