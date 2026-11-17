import Link from "next/link";
import type { Actor } from "@/lib/access";
import { signOut } from "@/auth";

const NAV = [
  { href: "/", label: "Home", key: "home" },
  { href: "/projects/new", label: "New project", key: "new", perm: "project.create" },
  { href: "/vendors", label: "Vendors", key: "vendors" },
  { href: "/unfiled", label: "Unfiled documents", key: "unfiled" },
];
const ADMIN = [
  { href: "/admin/people", label: "People", key: "people" },
  { href: "/admin/properties", label: "Properties", key: "properties" },
];

export function Shell({ actor, active, approvals = 0, children }: { actor: Actor; active: string; approvals?: number; children: React.ReactNode }) {
  const initials = actor.displayName.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header className="top">
        <div className="logo">GIT</div>
        <Link className="brand" href="/">Capital Projects</Link>
        <div style={{ flex: 1 }} />
        <Link className="topbtn" href="/#needs">Needs your OK · {approvals}</Link>
        <div className="row small">
          <span style={{ width: 32, height: 32, borderRadius: "50%", background: "#fff", color: "#1B3358", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>{initials}</span>
          <span>{actor.displayName}</span>
          <form action={async () => { "use server"; await signOut({ redirectTo: "/signin" }); }}>
            <button className="topbtn" style={{ border: 0, cursor: "pointer", font: "inherit" }}>Sign out</button>
          </form>
        </div>
      </header>
      <div className="shell">
        <nav className="rail" aria-label="Main">
          <div className="grp">Portfolio</div>
          {NAV.filter((n) => !n.perm || actor.can(n.perm)).map((n) => (
            <Link key={n.key} className={active === n.key ? "on" : ""} href={n.href}>{n.label}</Link>
          ))}
          {actor.can("people.manage") && (
            <>
              <div className="grp">Admin</div>
              {ADMIN.map((n) => (
                <Link key={n.key} className={active === n.key ? "on" : ""} href={n.href}>{n.label}</Link>
              ))}
            </>
          )}
        </nav>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}

export const money = (v: unknown) => {
  const n = Number(v ?? 0);
  return n === 0 ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
};
