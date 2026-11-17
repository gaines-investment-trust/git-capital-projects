"use client";
import { useActionState, useState } from "react";
import { createVendorAction, vendorPaperworkAction, type FormState } from "../rfp-actions";

export function NewVendorForm() {
  const [open, setOpen] = useState(false);
  const [s, action, pending] = useActionState<FormState, FormData>(createVendorAction, undefined);
  if (!open) return <div><button className="btn primary" onClick={() => setOpen(true)}>+ Add vendor</button></div>;
  return (
    <form action={action} className="card grid" style={{ alignItems: "end" }}>
      <label className="f">Company name<input name="name" required /></label>
      <label className="f">Short name (no spaces, optional)<input name="shortName" placeholder="BrandpointRoofing" /></label>
      <label className="f">Trades (comma-separated)<input name="trades" placeholder="roofing, gutters" /></label>
      <label className="f">States served<input name="statesServed" placeholder="TX, OK" /></label>
      <label className="f">Contact name<input name="contactName" required /></label>
      <label className="f">Contact email<input name="contactEmail" type="email" required /></label>
      <label className="f">Contact phone<input name="contactPhone" /></label>
      <label className="f">Yardi vendor ID (optional)<input name="yardiVendorId" /></label>
      <div className="row">
        <button className="btn primary" disabled={pending}>Save vendor</button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
        {s?.error && <span className="notice err">{s.error}</span>}
      </div>
    </form>
  );
}

export function PaperworkForms({ vendorId, status }: { vendorId: string; status: string }) {
  const [c, coiAction, p1] = useActionState<FormState, FormData>(vendorPaperworkAction, undefined);
  const [l, licAction, p2] = useActionState<FormState, FormData>(vendorPaperworkAction, undefined);
  const [st, statusAction, p3] = useActionState<FormState, FormData>(vendorPaperworkAction, undefined);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <form action={coiAction} className="grid" style={{ alignItems: "end" }}>
        <input type="hidden" name="vendorId" value={vendorId} /><input type="hidden" name="kind" value="coi" />
        <label className="f">Insurance carrier<input name="carrier" /></label>
        <label className="f">GL each occurrence ($)<input name="glEachOccurrence" type="number" /></label>
        <label className="f">GL aggregate ($)<input name="glAggregate" type="number" /></label>
        <label className="f">COI expires<input name="expiresOn" type="date" required /></label>
        <div className="row"><button className="btn" disabled={p1}>Add COI</button>{c?.ok && <span className="notice ok">{c.ok}</span>}{c?.error && <span className="notice err">{c.error}</span>}</div>
      </form>
      <form action={licAction} className="grid" style={{ alignItems: "end" }}>
        <input type="hidden" name="vendorId" value={vendorId} /><input type="hidden" name="kind" value="license" />
        <label className="f">License state<input name="state" maxLength={2} required placeholder="TX" /></label>
        <label className="f">License number<input name="licenseNumber" required /></label>
        <label className="f">Expires<input name="expiresOn" type="date" /></label>
        <div className="row"><button className="btn" disabled={p2}>Add license</button>{l?.ok && <span className="notice ok">{l.ok}</span>}{l?.error && <span className="notice err">{l.error}</span>}</div>
      </form>
      <form action={statusAction} className="row">
        <input type="hidden" name="vendorId" value={vendorId} /><input type="hidden" name="kind" value="status" />
        <label className="f" style={{ flexDirection: "row", alignItems: "center" }}>Status
          <select name="status" defaultValue={status}><option value="pending">Pending</option><option value="approved">Approved</option><option value="preferred">Preferred</option><option value="probation">Probation</option><option value="do_not_use">Do not use</option></select>
        </label>
        <button className="btn" disabled={p3}>Update status</button>{st?.ok && <span className="notice ok">{st.ok}</span>}{st?.error && <span className="notice err">{st.error}</span>}
      </form>
    </div>
  );
}
