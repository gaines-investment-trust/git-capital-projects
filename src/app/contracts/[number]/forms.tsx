"use client";
import { useActionState } from "react";
import { prepareContractAction, executedAction, type FormState } from "../../award-actions";

const Msg = ({ s }: { s: FormState }) => (s?.ok ? <span className="notice ok">{s.ok}</span> : s?.error ? <span className="notice err">{s.error}</span> : null);

export function PrepareButton({ number }: { number: string }) {
  const [s, action, pending] = useActionState<FormState, FormData>(prepareContractAction, undefined);
  return <form action={action} className="row"><input type="hidden" name="number" value={number} /><button className="btn primary" disabled={pending}>{pending ? "Generating…" : "Generate contract for signature"}</button><Msg s={s} /></form>;
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
