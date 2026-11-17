"use client";
import { useActionState } from "react";
import { uploadDocumentAction, type FormState } from "../../actions";

export function UploadForm({ projectCode, docTypes }: { projectCode: string; docTypes: { key: string; label: string }[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(uploadDocumentAction, undefined);
  return (
    <form action={action} className="grid" style={{ alignItems: "end" }}>
      <input type="hidden" name="projectCode" value={projectCode} />
      <label className="f">File<input name="file" type="file" required /></label>
      <label className="f">Document type<select name="docType">{docTypes.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
      <label className="f">Number or detail (optional)<input name="qualifier" placeholder="e.g. 01, Final, Conditional-Progress-03" /></label>
      <label className="f">Vendor or party<input name="party" defaultValue="GIT" /></label>
      <label className="f">Document date<input name="docDate" type="date" /></label>
      <div className="row">
        <button className="btn primary" disabled={pending}>{pending ? "Filing…" : "Upload and file"}</button>
        {state?.ok && <span className="notice ok">{state.ok}</span>}
        {state?.error && <span className="notice err">{state.error}</span>}
      </div>
    </form>
  );
}
