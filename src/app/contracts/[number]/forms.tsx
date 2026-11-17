"use client";
import { useActionState } from "react";
import { prepareContractAction, executedAction, voidSignatureAction, type FormState } from "../../award-actions";

const Msg = ({ s }: { s: FormState }) => (s?.ok ? <span className="notice ok">{s.ok}</span> : s?.error ? <span className="notice err">{s.error}</span> : null);

export function PrepareButton({ number, docusign }: { number: string; docusign: boolean }) {
  const [s, action, pending] = useActionState<FormState, FormData>(prepareContractAction, undefined);
  return <form action={action} className="row"><input type="hidden" name="number" value={number} /><button className="btn primary" disabled={pending}>{pending ? (docusign ? "Sending…" : "Generating…") : docusign ? "Send for signature (DocuSign)" : "Generate contract for signature"}</button><Msg s={s} /></form>;
}

export function VoidForm({ number }: { number: string }) {
  const [s, action, pending] = useActionState<FormState, FormData>(voidSignatureAction, undefined);
  return (
    <details><summary className="small">Pull back for changes</summary>
      <form action={action} className="row" style={{ marginTop: 8 }}>
        <input type="hidden" name="number" value={number} />
        <label className="f" style={{ flex: "1 1 320px" }}>Reason (shown to the signers)<input name="reason" required minLength={5} /></label>
        <button className="btn" disabled={pending} style={{ alignSelf: "flex-end" }}>Void and return to draft</button><Msg s={s} />
      </form>
    </details>
  );
}

export function ExecutedForm({ number }: { number: string }) {
  const [s, action, pending] = useActionState<FormState, FormData>(executedAction, undefined);
  return (
    <form action={action} className="row">
      <input type="hidden" name="number" value={number} />
      <label className="f">Signed contract (PDF)<input type="file" name="file" accept="application/pdf,.pdf" required /></label>
      <button className="btn primary" disabled={pending} style={{ alignSelf: "flex-end" }}>Record as executed</button>
      <Msg s={s} />
    </form>
  );
}
