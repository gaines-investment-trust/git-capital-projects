import NextAuth, { type NextAuthConfig } from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import Credentials from "next-auth/providers/credentials";
import { redirect } from "next/navigation";
import { one, withTx } from "@/lib/db";
import { env } from "@/lib/env";
import { loadActor, type Actor } from "@/lib/access";

/**
 * Staff sign in with their Microsoft 365 account (Entra ID SSO, MFA enforced by the tenant).
 * Nobody outside the people list can get in, except the bootstrap admin (Joe) on first run.
 */
async function resolveUser(email: string, name: string, entraOid?: string): Promise<string | null> {
  const existing = await one<{ id: string; is_active: boolean }>(`select id, is_active from app_user where lower(email) = lower($1)`, [email]);
  if (existing) {
    if (!existing.is_active) return null;
    await withTx(existing.id, (c) =>
      c.query(`update app_user set last_sign_in_at = now(), entra_object_id = coalesce(entra_object_id, $2) where id = $1`, [existing.id, entraOid ?? null]),
    );
    return existing.id;
  }
  if (email.toLowerCase() !== env().BOOTSTRAP_ADMIN_EMAIL.toLowerCase()) return null;
  const anyone = await one(`select 1 from user_role limit 1`);
  if (anyone) return null;
  return withTx(null, async (c) => {
    const u = (await c.query(
      `insert into app_user (entra_object_id, email, display_name, job_title, kind, last_sign_in_at) values ($1,$2,$3,'COO','employee', now()) returning id`,
      [entraOid ?? null, email, name],
    )).rows[0];
    await c.query(
      `insert into user_role (user_id, role_id, scope_kind) select $1, id, 'all' from role where code in ('executive','admin')`,
      [u.id],
    );
    return u.id as string;
  });
}

const e = env();
const providers: NextAuthConfig["providers"] = [];
if (e.AUTH_MICROSOFT_ENTRA_ID_ID) {
  providers.push(
    MicrosoftEntraID({
      clientId: e.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: e.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: `https://login.microsoftonline.com/${e.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID}/v2.0`,
      authorization: { params: { scope: "openid profile email offline_access User.Read User.ReadBasic.All" } },
    }),
  );
}
if (e.AUTH_DEV_LOGIN && process.env.NODE_ENV !== "production") {
  providers.push(
    Credentials({
      id: "dev",
      name: "Development sign-in",
      credentials: { email: { label: "Email", type: "email" } },
      async authorize(creds) {
        const email = String(creds?.email ?? "");
        const u = await one<{ id: string; display_name: string }>(`select id, display_name from app_user where lower(email) = lower($1) and is_active`, [email]);
        const id = u?.id ?? (await resolveUser(email, "Joe Gerber"));
        return id ? { id, email, name: u?.display_name ?? "Joe Gerber" } : null;
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 }, // 8-hour staff sessions (security 2.1)
  pages: { signIn: "/signin", error: "/signin" },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === "dev") return !!user.id;
      const email = (profile?.email ?? (profile as any)?.preferred_username ?? user.email) as string | undefined;
      if (!email) return false;
      const id = await resolveUser(email, user.name ?? email, (profile as any)?.oid);
      if (!id) return "/signin?error=NoAccess";
      user.id = id;
      return true;
    },
    async jwt({ token, user, account }) {
      if (user?.id) token.uid = user.id;
      if (account?.access_token) {
        token.graphToken = account.access_token;
        token.graphTokenExp = account.expires_at;
      }
      return token;
    },
    async session({ session, token }) {
      (session as any).uid = token.uid;
      (session as any).graphToken = token.graphToken;
      return session;
    },
  },
});

/** Use at the top of every server page/action. Redirects to sign-in when needed. */
export async function requireActor(): Promise<Actor> {
  const s = await auth();
  const uid = (s as any)?.uid as string | undefined;
  if (!uid) redirect("/signin");
  const actor = await loadActor(uid);
  if (!actor) redirect("/signin?error=NoAccess");
  return actor;
}

export async function graphToken(): Promise<string | null> {
  const s = await auth();
  return ((s as any)?.graphToken as string | undefined) ?? null;
}
