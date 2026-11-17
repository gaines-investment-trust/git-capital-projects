import { signIn } from "@/auth";
import { env } from "@/lib/env";

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const e = env();
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div className="card" style={{ maxWidth: 420, width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="row"><div className="logo" style={{ background: "#1B3358", color: "#fff" }}>GIT</div><div><b>Gaines Investment Trust</b><div className="small muted">Capital Projects</div></div></div>
        {error === "NoAccess" && <div className="notice err">Your account doesn't have access yet. Ask Joe Gerber or an admin to add you.</div>}
        {error && error !== "NoAccess" && <div className="notice err">Sign-in didn't complete. Try again.</div>}
        {e.AUTH_MICROSOFT_ENTRA_ID_ID && (
          <form action={async () => { "use server"; await signIn("microsoft-entra-id", { redirectTo: "/" }); }}>
            <button className="btn primary" style={{ width: "100%" }}>Sign in with Microsoft</button>
          </form>
        )}
        {e.AUTH_DEV_LOGIN && process.env.NODE_ENV !== "production" && (
          <form
            action={async (fd: FormData) => { "use server"; await signIn("dev", { email: String(fd.get("email")), redirectTo: "/" }); }}
            style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid #E1E5EB", paddingTop: 14 }}
          >
            <label className="f">Development sign-in (local only)<input name="email" type="email" defaultValue={e.BOOTSTRAP_ADMIN_EMAIL} /></label>
            <button className="btn">Sign in without Microsoft</button>
          </form>
        )}
      </div>
    </div>
  );
}
