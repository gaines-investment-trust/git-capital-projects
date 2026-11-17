import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withTx } from "./db";
import { env } from "./env";

export type Attachment = { name: string; contentType: string; content: Buffer };
export type OutgoingMail = {
  fromUserId: string;
  fromAddress: string;
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  attachments?: Attachment[];
  projectId?: string | null;
  rfpId?: string | null;
  vendorId?: string | null;
};

/**
 * Sends as the acting employee (build prompt 4.2: email goes out from their own Outlook so vendors
 * reply to them), with the project mailbox in CC. Production: Graph /me/sendMail with the user's
 * delegated token. Development and tests: written to .data/outbox and logged, nothing leaves.
 */
export async function sendMail(m: OutgoingMail, delegatedToken: string | null): Promise<{ id: string; mode: "graph" | "outbox" }> {
  const projectMailbox = process.env.PROJECT_MAILBOX; // e.g. capex@gainesinvestmenttrust.com once IT creates it
  const cc = [...(m.cc ?? []), ...(projectMailbox ? [projectMailbox] : [])];
  const useGraph = env().DOCSTORE === "graph" && delegatedToken;
  let mode: "graph" | "outbox" = "outbox";

  if (useGraph) {
    const body = {
      message: {
        subject: m.subject,
        body: { contentType: "HTML", content: m.html },
        toRecipients: m.to.map((a) => ({ emailAddress: { address: a } })),
        ccRecipients: cc.map((a) => ({ emailAddress: { address: a } })),
        attachments: (m.attachments ?? []).map((a) => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: a.name,
          contentType: a.contentType,
          contentBytes: a.content.toString("base64"),
        })),
      },
      saveToSentItems: true,
    };
    const r = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: { Authorization: `Bearer ${delegatedToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`Outlook refused the email (${r.status}). Sign out and back in, then try again.`);
    mode = "graph";
  } else {
    const dir = join(env().LOCAL_DOCSTORE_DIR, "..", "outbox");
    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await writeFile(join(dir, `${stamp}_${m.to[0]}.html`), `<p>From: ${m.fromAddress}<br>To: ${m.to.join(", ")}<br>Cc: ${cc.join(", ")}<br>Subject: ${m.subject}<br>Attachments: ${(m.attachments ?? []).map((a) => a.name).join(", ")}</p><hr>${m.html}`);
  }

  const row = await withTx(m.fromUserId, async (c) =>
    (await c.query(
      `insert into email_message (mailbox, direction, subject, from_address, to_addresses, sent_at, project_id, rfp_id, vendor_id, match_method, body_html, status, sent_by)
       values ($1,'out',$2,$1,$3, now(), $4,$5,$6,'sent_by_app',$7,$8,$9) returning id`,
      [m.fromAddress, m.subject, [...m.to, ...cc], m.projectId ?? null, m.rfpId ?? null, m.vendorId ?? null, m.html, mode === "graph" ? "sent" : "outbox", m.fromUserId],
    )).rows[0],
  );
  return { id: row.id, mode };
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
