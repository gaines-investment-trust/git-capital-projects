import { createHmac, createSign, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * DocuSign eSignature (build prompt 4.3), over plain REST:
 * - JWT grant as GIT's API user (no person signs in to DocuSign for the app);
 * - one envelope per contract: the Word contract, vendor signs first, then GIT's signatory;
 * - DocuSign Connect calls /api/docusign/connect when the envelope completes, HMAC-signed.
 * The private key and Connect HMAC key come from Key Vault. Fetch is injectable for tests.
 */

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...a) => fetch(...a);
export function setDocusignFetch(f: Fetch | null) {
  fetchImpl = f ?? ((...a) => fetch(...a));
  token = null;
}

export function docusignEnabled(): boolean {
  const e = env();
  return !!(e.DOCUSIGN_INTEGRATION_KEY && e.DOCUSIGN_USER_ID && e.DOCUSIGN_ACCOUNT_ID && e.DOCUSIGN_BASE_URI && e.DOCUSIGN_PRIVATE_KEY);
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** Key Vault and env files often flatten PEM newlines to "\n"; restore them. */
function pem(key: string) {
  return key.includes("\\n") ? key.replace(/\\n/g, "\n") : key;
}

let token: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;
  const e = env();
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: e.DOCUSIGN_INTEGRATION_KEY, sub: e.DOCUSIGN_USER_ID, aud: e.DOCUSIGN_AUTH_SERVER, iat: now, exp: now + 3600, scope: "signature impersonation" }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${body}`);
  const jwt = `${header}.${body}.${b64url(signer.sign(pem(e.DOCUSIGN_PRIVATE_KEY!)))}`;
  const res = await fetchImpl(`https://${e.DOCUSIGN_AUTH_SERVER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (j.error === "consent_required") {
      throw new Error(`DocuSign needs one-time consent for the integration key. Open ${consentUrl()} signed in as the DocuSign API user and click Allow.`);
    }
    throw new Error(`DocuSign sign-in failed: ${j.error_description ?? j.error ?? res.status}`);
  }
  token = { value: j.access_token, expiresAt: Date.now() + Number(j.expires_in ?? 3600) * 1000 };
  return token.value;
}

/** The one-time page where GIT's DocuSign API user grants the app permission to send as them. */
export function consentUrl(): string {
  const e = env();
  const q = new URLSearchParams({ response_type: "code", scope: "signature impersonation", client_id: e.DOCUSIGN_INTEGRATION_KEY ?? "", redirect_uri: `${e.APP_BASE_URL}/api/docusign/consent` });
  return `https://${e.DOCUSIGN_AUTH_SERVER}/oauth/auth?${q}`;
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const e = env();
  const res = await fetchImpl(`${e.DOCUSIGN_BASE_URI!.replace(/\/$/, "")}/restapi/v2.1/accounts/${e.DOCUSIGN_ACCOUNT_ID}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const j: any = await res.json().catch(() => ({}));
    throw new Error(`DocuSign: ${j.message ?? j.errorCode ?? res.status}`);
  }
  return res;
}

export type Signer = { name: string; email: string };

/** Anchor strings written invisibly into the contract's signature block (lib/contractdoc.ts). */
export const ANCHORS = { contractor: { sign: "\\gitk1s\\", date: "\\gitk1d\\" }, owner: { sign: "\\gitk2s\\", date: "\\gitk2d\\" } } as const;

const tabs = (a: { sign: string; date: string }) => ({
  signHereTabs: [{ anchorString: a.sign, anchorUnits: "pixels", anchorXOffset: "0", anchorYOffset: "-6" }],
  dateSignedTabs: [{ anchorString: a.date, anchorUnits: "pixels", anchorXOffset: "0", anchorYOffset: "-6" }],
});

/** Sends the contract: the vendor signs first, then GIT. Returns the envelope id. */
export async function sendContractEnvelope(i: {
  contractNumber: string; contractId: string; documentName: string; docx: Buffer; contractor: Signer; owner: Signer; cc?: Signer[]; emailBody?: string;
}): Promise<string> {
  const res = await api("/envelopes", {
    method: "POST",
    body: JSON.stringify({
      emailSubject: `${i.contractNumber} · Contract for signature · Gaines Investment Trust`.slice(0, 100),
      emailBlurb: i.emailBody ?? "Please review and sign the attached contract. Gaines Investment Trust will countersign once you have signed.",
      documents: [{ documentId: "1", name: i.documentName, fileExtension: "docx", documentBase64: i.docx.toString("base64") }],
      recipients: {
        signers: [
          { recipientId: "1", routingOrder: "1", name: i.contractor.name, email: i.contractor.email, tabs: tabs(ANCHORS.contractor) },
          { recipientId: "2", routingOrder: "2", name: i.owner.name, email: i.owner.email, tabs: tabs(ANCHORS.owner) },
        ],
        carbonCopies: (i.cc ?? []).map((c, n) => ({ recipientId: String(10 + n), routingOrder: "3", name: c.name, email: c.email })),
      },
      customFields: { textCustomFields: [{ name: "gitContractId", value: i.contractId, show: "false" }] },
      status: "sent",
    }),
  });
  const j: any = await res.json();
  return j.envelopeId as string;
}

/** The completed contract with all signatures and DocuSign's certificate of completion, as one PDF. */
export async function downloadCompleted(envelopeId: string): Promise<Buffer> {
  const res = await api(`/envelopes/${encodeURIComponent(envelopeId)}/documents/combined?certificate=true`, { headers: { Accept: "application/pdf" } });
  return Buffer.from(await res.arrayBuffer());
}

export async function voidEnvelope(envelopeId: string, reason: string) {
  await api(`/envelopes/${encodeURIComponent(envelopeId)}`, { method: "PUT", body: JSON.stringify({ status: "voided", voidedReason: reason.slice(0, 200) }) });
}

/** Connect messages carry X-DocuSign-Signature-1 = base64(HMAC-SHA256(key, raw body)). Rejects when no key is set. */
export function verifyConnect(rawBody: string, headers: Headers): boolean {
  const key = env().DOCUSIGN_CONNECT_HMAC_KEY;
  if (!key) return false;
  const want = createHmac("sha256", key).update(rawBody, "utf8").digest();
  for (let n = 1; n <= 5; n++) {
    const got = headers.get(`x-docusign-signature-${n}`);
    if (!got) continue;
    const g = Buffer.from(got, "base64");
    if (g.length === want.length && timingSafeEqual(g, want)) return true;
  }
  return false;
}
