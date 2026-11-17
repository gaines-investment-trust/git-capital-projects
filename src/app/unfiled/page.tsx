import { requireActor } from "@/auth";
import { unfiledQueue } from "@/services/filing";
import { Shell } from "../shell";

export const dynamic = "force-dynamic";

export default async function Unfiled() {
  const actor = await requireActor();
  const rows = await unfiledQueue();
  return (
    <Shell actor={actor} active="unfiled">
      <h1>Unfiled documents</h1>
      <div className="muted">Documents the app couldn't file with 90% confidence wait here for a person. Nothing is filed silently.</div>
      <section className="card scroll">
        {rows.length === 0 ? <div className="muted">Nothing waiting.</div> : (
          <table><thead><tr><th>Received</th><th>Original name</th><th>Best guess</th><th className="num">Confidence</th><th>Source</th></tr></thead>
            <tbody>{rows.map((r: any) => (
              <tr key={r.id}><td>{new Date(r.created_at).toLocaleString("en-US")}</td><td>{r.original_file_name}</td><td>{r.project_code ?? "No project"} · {r.doc_type}</td>
                <td className="num">{r.classification_confidence === null ? "—" : `${Math.round(Number(r.classification_confidence) * 100)}%`}</td><td>{r.source}</td></tr>
            ))}</tbody></table>
        )}
      </section>
    </Shell>
  );
}
