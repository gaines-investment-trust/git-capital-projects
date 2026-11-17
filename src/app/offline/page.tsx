export const dynamic = "force-static";

export default function Offline() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div className="card" style={{ maxWidth: 420, display: "flex", flexDirection: "column", gap: 10 }}>
        <h1>You're offline</h1>
        <p className="muted" style={{ margin: 0 }}>Project data needs a connection so numbers and approvals are always current. Reconnect and this page reloads.</p>
        <a className="btn primary" href="/">Try again</a>
      </div>
    </div>
  );
}
