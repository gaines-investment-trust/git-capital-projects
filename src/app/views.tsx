import Link from "next/link";
import type { PortfolioRow } from "@/services/projects";
import { money } from "./shell";

export const HEALTH: Record<string, string> = { on_track: "On track", at_risk: "At risk", late: "Late", blocked: "Blocked" };
const COLOR: Record<string, string> = { on_track: "#2E8B57", at_risk: "#D9940B", late: "#C6392B", blocked: "#6B46C1" };
const STAGES = ["Planning", "RFP", "Bidding", "Award", "Contract", "In Progress", "Punch", "Closeout"];

export function ViewTabs({ view }: { view: string }) {
  return (
    <div role="group" aria-label="View" className="row">
      {[["grid", "Grid"], ["board", "Board by stage"], ["gantt", "Gantt"]].map(([k, l]) => (
        <Link key={k} href={`/?view=${k}`} className={`btn ${view === k ? "primary" : ""}`}>{l}</Link>
      ))}
      <a className="btn" href="/api/export/portfolio">Export to Excel</a>
    </div>
  );
}

export function Board({ rows }: { rows: PortfolioRow[] }) {
  return (
    <div className="scroll"><div style={{ display: "grid", gridTemplateColumns: `repeat(${STAGES.length}, minmax(170px, 1fr))`, gap: 10 }}>
      {STAGES.map((s) => {
        const items = rows.filter((r) => r.stage_name === s);
        return (
          <div key={s} style={{ background: "#F4F6F9", borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 8, minHeight: 160 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{s} <span className="muted">· {items.length}</span></div>
            {items.map((r) => (
              <Link key={r.id} href={`/projects/${r.project_code}`} className="card" style={{ padding: "10px 12px", textDecoration: "none", color: "inherit", display: "flex", flexDirection: "column", gap: 4 }}>
                <b style={{ fontSize: 13 }}>{r.project_code}</b>
                <span className="small">{r.property_name} · {r.type_name}</span>
                <span className="small muted">{money(r.budget)} · {r.manager}</span>
                <span className={`pill ${r.health}`} style={{ alignSelf: "flex-start" }}>{HEALTH[r.health]}</span>
              </Link>
            ))}
          </div>
        );
      })}
    </div></div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function Gantt({ rows }: { rows: (PortfolioRow & { baseline_start?: string | null; baseline_end?: string | null })[] }) {
  const dated = rows.filter((r) => r.planned_start && r.planned_end);
  if (dated.length === 0) return <div className="muted">Projects need start and end dates to appear on the timeline.</div>;
  const t = (d: string) => Date.parse(String(d).slice(0, 10));
  const lo0 = Math.min(...dated.map((r) => t(r.planned_start!)), Date.now());
  const hi0 = Math.max(...dated.map((r) => t(r.planned_end!)));
  const start = new Date(lo0); start.setUTCDate(1);
  const end = new Date(hi0); end.setUTCMonth(end.getUTCMonth() + 1, 1);
  const lo = start.getTime(), hi = end.getTime();
  const pos = (ms: number) => ((ms - lo) / (hi - lo)) * 100;
  const months: { label: string; left: number }[] = [];
  for (const m = new Date(lo); m.getTime() < hi; m.setUTCMonth(m.getUTCMonth() + 1)) {
    months.push({ label: `${MONTHS[m.getUTCMonth()]}${m.getUTCMonth() === 0 || months.length === 0 ? ` ${m.getUTCFullYear()}` : ""}`, left: pos(m.getTime()) });
  }
  const today = pos(Date.now());
  return (
    <div className="scroll"><div style={{ minWidth: 900 }}>
      <div style={{ display: "flex" }}><div style={{ width: 260, flex: "none" }} />
        <div style={{ flex: 1, position: "relative", height: 20 }}>
          {months.map((m) => <span key={m.left} className="small muted" style={{ position: "absolute", left: `${m.left}%`, borderLeft: "1px solid #E1E5EB", paddingLeft: 4 }}>{m.label}</span>)}
        </div>
      </div>
      {dated.map((r) => {
        const l = pos(t(r.planned_start!)), w = Math.max(0.6, pos(t(r.planned_end!)) - l);
        const bl = r.baseline_start && r.baseline_end ? [pos(t(r.baseline_start)), pos(t(r.baseline_end)) - pos(t(r.baseline_start))] : null;
        return (
          <div key={r.id} style={{ display: "flex", alignItems: "center", height: 34 }}>
            <div style={{ width: 260, flex: "none", fontSize: 13 }}><Link href={`/projects/${r.project_code}`} style={{ fontWeight: 600 }}>{r.project_code}</Link> <span className="muted">{r.type_name}</span></div>
            <div style={{ flex: 1, position: "relative", height: 34, background: "#FAFBFC", borderRadius: 6 }}>
              {bl && <div title="Baseline" style={{ position: "absolute", top: 9, height: 16, left: `${bl[0]}%`, width: `${bl[1]}%`, border: "1px dashed #9AA6B6", borderRadius: 8 }} />}
              <div title={`${HEALTH[r.health]}`} style={{ position: "absolute", top: 9, height: 16, left: `${l}%`, width: `${w}%`, background: COLOR[r.health] ?? "#9AA6B6", borderRadius: 8 }} />
              {today >= 0 && today <= 100 && <div style={{ position: "absolute", top: 0, bottom: 0, left: `${today}%`, width: 2, background: "#1B3358" }} />}
            </div>
          </div>
        );
      })}
      <div className="small muted" style={{ marginTop: 6 }}>Dashed outline = baseline · navy line = today · colour = health</div>
    </div></div>
  );
}
