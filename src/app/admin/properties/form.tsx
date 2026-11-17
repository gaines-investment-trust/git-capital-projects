"use client";
import { useActionState } from "react";
import { addPropertyAction, type FormState } from "../../actions";

export function PropertyForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(addPropertyAction, undefined);
  return (
    <form action={action} className="card grid" style={{ alignItems: "end" }}>
      <label className="f">Code (3 letters)<input name="code" required maxLength={3} placeholder="TUS" /></label>
      <label className="f">Name<input name="name" required placeholder="Tuscany Square" /></label>
      <label className="f">State<select name="state" defaultValue="TX">{["TX", "CA", "NV", "OK", "AZ"].map((s) => <option key={s}>{s}</option>)}</select></label>
      <label className="f">City<input name="city" /></label>
      <label className="f">Units<input name="units" type="number" min="0" /></label>
      <label className="f">Yardi property code<input name="yardiPropertyCode" /></label>
      <div className="row">
        <button className="btn primary" disabled={pending}>Add property</button>
        {state?.ok && <span className="notice ok">{state.ok}</span>}
        {state?.error && <span className="notice err">{state.error}</span>}
      </div>
    </form>
  );
}
