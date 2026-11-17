"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import { decideAction, type FormState } from "./rfp-actions";

export type InboxItem = {
  id: string; object_type: string; object_id: string; summary: string | null; amount: string | null; step: number;
  days_waiting: number; project_code: string | null; requested_by_name: string | null; link: string | null; decision: string | null;
};

const LABEL: Record<string, string> = { rfp: "RFP to bid", award: "Award", contract: "Contract", change_order: "Change order", pay_request: "Pay request", override: "Override", closeout: "Closeout" };

function Card({ a }: { a: InboxItem }) {
  const [state, action, pending] = useActionState<FormState, FormData>(decideAction, undefined);
  const [mode, setMode] = useState<"" | "changes_requested" | "discuss">("");
  if (state?.ok) return <div className="notice ok" style={{ margin: "6px 0" }}>{a.summary}: {state.ok}</div>;
  return (
    <div style={{ borderTop: "1px solid #EEF1F5", padding: "12px 0", display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <span className="pill">{LABEL[a.object_type] ?? a.object_type}</span>
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{a.link ? <Link href={a.link}>{a.summary}</Link> : a.summary}</div>
          <div className="small muted">{a.project_code ? `${a.project_code} · ` : ""}from {a.requested_by_name ?? "—"} · step {a.step} · waiting {a.days_waiting} day{a.days_waiting === 1 ? "" : "s"}{a.decision === "discuss" ? " · marked for discussion" : ""}</div>
        </div>
        {a.amount && Number(a.amount) > 0 && <div className="num" style={{ fontWeight: 600 }}>{Number(a.amount).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}</div>}
      </div>
      <form action={action} className="row">
        <input type="hidden" name="approvalId" value={a.id} />
        {mode === "" ? (
          <>
            <button className="btn primary" name="decision" value="approved" disabled={pending}>Approve</button>
            <button type="button" className="btn" onClick={() => setMode("changes_requested")}>Request changes</button>
            <button type="button" className="btn" onClick={() => setMode("discuss")}>Discuss</button>
          </>
        ) : (
          <>
            <input name="note" required placeholder={mode === "discuss" ? "What do you want to discuss?" : "What needs to change?"} style={{ flex: "1 1 300px", font: "inherit", border: "1px solid #C9D1DC", borderRadius: 8, padding: "9px 10px", minHeight: 40 }} />
            <button className="btn primary" name="decision" value={mode} disabled={pending}>{mode === "discuss" ? "Send" : "Send back"}</button>
            <button type="button" className="btn" onClick={() => setMode("")}>Cancel</button>
          </>
        )}
        {state?.error && <span className="notice err">{state.error}</span>}
      </form>
    </div>
  );
}

export function Inbox({ items }: { items: InboxItem[] }) {
  if (!items.length) return <div className="muted">Nothing waiting for you.</div>;
  return <div>{items.map((a) => <Card key={a.id} a={a} />)}</div>;
}
