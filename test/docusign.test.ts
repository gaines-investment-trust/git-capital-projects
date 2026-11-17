import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { createHmac, createVerify, generateKeyPairSync } from "node:crypto";
import { Client } from "pg";

const base = process.env.TEST_DATABASE_URL;
const url = base ? `${base}_ds` : undefined;
const run = url ? describe : describe.skip;

/** A stand-in for DocuSign's REST API that records every call. */
function fakeDocusign(publicKey: string) {
  const calls: { url: string; method: string; body: any; headers: Record<string, string> }[] = [];
  let n = 0;
  const f = async (input: any, init: any = {}) => {
    const u = String(input), method = init.method ?? "GET";
    const body = typeof init.body === "string" ? (u.includes("oauth") ? init.body : JSON.parse(init.body)) : init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : init.body;
    calls.push({ url: u, method, body, headers: init.headers ?? {} });
    if (u.endsWith("/oauth/token")) {
      const [h, p, s] = String(body.assertion).split(".");
      const ok = createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s, "base64url"));
      if (!ok) return Response.json({ error: "invalid_grant" }, { status: 400 });
      return Response.json({ access_token: "tok-" + ++n, expires_in: 3600 });
    }
    if (u.endsWith("/envelopes") && method === "POST") return Response.json({ envelopeId: `env-${calls.length}`, status: "sent" }, { status: 201 });
    if (u.includes("/documents/combined")) return new Response(Buffer.from("%PDF-1.7 signed by both + certificate"), { headers: { "Content-Type": "application/pdf" } });
    if (method === "PUT") return Response.json({});
    return Response.json({ message: "unexpected" }, { status: 404 });
  };
  return { f: f as typeof fetch, calls };
}

run("DocuSign: send, track, complete, void", () => {
  let m: any, ds: ReturnType<typeof fakeDocusign>;
  let joe: string, sean: string, seanA: any, projectId: string, vendorId: string;
  const HMAC = "connect-hmac-test-key";
  let seq = 0;

  const newContract = async () => {
    const no = `TST-K${String(++seq).padStart(2, "0")}`;
    const k = (await m.db.query(`insert into contract (contract_number, project_id, vendor_id, original_value, payment_terms, warranty_years) values ($1,$2,$3,50000,'Net 30',2) returning id`, [no, projectId, vendorId]))[0].id;
    await m.db.query(`insert into sov_line (contract_id, line_no, description, scheduled_value) values ($1,'1','Roofing',50000)`, [k]);
    return no;
  };
  const connect = async (event: string, envelopeId: string, extra: any = {}) => {
    const raw = JSON.stringify({ event, generatedDateTime: new Date().toISOString(), data: { envelopeId, ...extra } });
    const sig = createHmac("sha256", HMAC).update(raw).digest("base64");
    const { POST } = await import("@/app/api/docusign/connect/route");
    return POST(new Request("https://cpp.example/api/docusign/connect", { method: "POST", body: raw, headers: { "content-type": "application/json", "x-docusign-signature-1": sig } }));
  };

  beforeAll(async () => {
    const admin = new Client({ connectionString: url!.replace(/\/[^/]+$/, "/postgres") });
    await admin.connect();
    const name = url!.split("/").pop()!;
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.query(`create database ${name}`);
    await admin.end();
    execSync("node scripts/migrate.mjs", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs1", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    Object.assign(process.env, {
      DATABASE_URL: url, AUTH_SECRET: "test-secret-0123456789", DOCSTORE: "local", LOCAL_DOCSTORE_DIR: join(mkdtempSync(join(tmpdir(), "gcpds-")), "sp"), APP_BASE_URL: "https://cpp.example",
      DOCUSIGN_INTEGRATION_KEY: "ik-test", DOCUSIGN_USER_ID: "1e044bae-a87c-446b-a99b-9d9496a8298a", DOCUSIGN_ACCOUNT_ID: "4cbbfba6-a3b1-4bc8-afcb-9c8be5577e71",
      DOCUSIGN_BASE_URI: "https://demo.docusign.net", DOCUSIGN_AUTH_SERVER: "account-d.docusign.com",
      DOCUSIGN_PRIVATE_KEY: privateKey.replace(/\n/g, "\\n"), // as Key Vault often stores it
      DOCUSIGN_CONNECT_HMAC_KEY: HMAC,
    });
    m = { db: await import("@/lib/db"), access: await import("@/lib/access"), people: await import("@/services/people"), projects: await import("@/services/projects"),
          vendors: await import("@/services/vendors"), contracts: await import("@/services/contracts"), docusign: await import("@/lib/docusign") };
    ds = fakeDocusign(publicKey);
    m.docusign.setDocusignFetch(ds.f);
    joe = (await m.db.query(`insert into app_user(email, display_name, kind) values ('joeg@gainesinvestmenttrust.com','Joe Gerber','employee') returning id`))[0].id;
    await m.db.query(`insert into user_role(user_id, role_id, scope_kind) select $1, id, 'all' from role where code in ('executive','admin')`, [joe]);
    const joeA = await m.access.loadActor(joe);
    const prop = (await m.db.query(`insert into property(code, name, state, region_id) values ('TUS','Tuscany Square','TX',(select id from region where code='TX')) returning id`))[0].id;
    sean = (await m.people.addPerson(joeA, { email: "sean@gainesinvestmenttrust.com", displayName: "Sean Hunter", roleCode: "capex_pm", scopeKind: "property", scopeIds: [prop], approvalLimit: 9999.99 })).userId;
    seanA = await m.access.loadActor(sean);
    projectId = (await m.projects.createProject(seanA, { propertyId: prop, projectTypeCode: "roof", name: "Roof", managerUserId: sean, plannedStart: "2030-03-02", budgetSource: "reserves", budgetAmount: 60000 })).id;
    vendorId = (await m.vendors.createVendor(seanA, { name: "Lone Star Roof Systems", trades: ["roofing"], statesServed: ["TX"], contactName: "Ray Ortiz", contactEmail: "ray@lonestar.com" })).id;
    await m.vendors.addCoi(seanA, { vendorId, expiresOn: "2099-01-01" });
    await m.vendors.addLicense(seanA, { vendorId, state: "TX", licenseNumber: "TX-1" });
    await m.vendors.uploadVendorDoc(seanA, vendorId, "W9", { name: "w9.pdf", content: Buffer.from("%PDF-1.4 w9"), contentType: "application/pdf" });
  });

  it("signs in by JWT and sends the contract: vendor first, then GIT's signatory, PM copied", async () => {
    const no = await newContract();
    const r = await m.contracts.prepareForSignature(seanA, no);
    expect(r.docusign).toBe(true);
    const tokenCall = ds.calls.find((c) => c.url === "https://account-d.docusign.com/oauth/token")!;
    const claims = JSON.parse(Buffer.from(tokenCall.body.assertion.split(".")[1], "base64url").toString());
    expect(claims).toMatchObject({ iss: "ik-test", sub: "1e044bae-a87c-446b-a99b-9d9496a8298a", aud: "account-d.docusign.com", scope: "signature impersonation" });
    const send = ds.calls.find((c) => c.method === "POST" && c.url.endsWith("/envelopes"))!;
    expect(send.url).toBe("https://demo.docusign.net/restapi/v2.1/accounts/4cbbfba6-a3b1-4bc8-afcb-9c8be5577e71/envelopes");
    expect(send.headers.Authorization).toBe("Bearer tok-1");
    const [vendor, owner] = send.body.recipients.signers;
    expect(vendor).toMatchObject({ email: "ray@lonestar.com", routingOrder: "1" });
    expect(owner).toMatchObject({ email: "jeffg@gainesinvestmenttrust.com", name: "Jeff Gaines", routingOrder: "2" });
    expect(send.body.recipients.carbonCopies[0].email).toBe("sean@gainesinvestmenttrust.com");
    expect(vendor.tabs.signHereTabs[0].anchorString).toBe(m.docusign.ANCHORS.contractor.sign);
    expect(send.body.documents[0].fileExtension).toBe("docx");
    // the anchors really are in the Word file DocuSign receives
    const docx = join(mkdtempSync(join(tmpdir(), "gcpdx-")), "k.docx");
    writeFileSync(docx, Buffer.from(send.body.documents[0].documentBase64, "base64"));
    const xml = execSync(`unzip -p "${docx}" word/document.xml`).toString();
    for (const a of [m.docusign.ANCHORS.contractor.sign, m.docusign.ANCHORS.owner.sign, m.docusign.ANCHORS.owner.date]) expect(xml).toContain(a);
    const k = (await m.db.query(`select status, signature_status, docusign_envelope_id from contract where contract_number = $1`, [no]))[0];
    expect(k).toMatchObject({ status: "out_for_signature", signature_status: "sent" });
    expect(k.docusign_envelope_id).toMatch(/^env-/);
  });

  it("tracks progress and, on completion, files DocuSign's signed PDF and executes the contract once", async () => {
    const no = await newContract();
    await m.contracts.prepareForSignature(seanA, no);
    const env = (await m.db.query(`select docusign_envelope_id e from contract where contract_number = $1`, [no]))[0].e;
    expect((await connect("envelope-delivered", env)).status).toBe(200);
    await connect("recipient-completed", env, { recipientId: "1" });
    expect((await m.db.query(`select signature_status s from contract where contract_number = $1`, [no]))[0].s).toBe("signed_by_vendor");
    const res = await connect("envelope-completed", env);
    expect(await res.json()).toEqual({ status: "executed" });
    const k = (await m.db.query(`select k.status, k.signature_status, k.signed_via, d.file_name, d.source from contract k join document d on d.id = k.executed_document_id where contract_number = $1`, [no]))[0];
    expect(k).toMatchObject({ status: "executed", signature_status: "completed", signed_via: "docusign", source: "docusign" });
    expect(k.file_name).toMatch(/_Contract-Executed_LoneStarRoofSystems_\d{4}-\d{2}-\d{2}_v\d+\.pdf$/);
    expect(ds.calls.some((c) => c.url.includes(`/envelopes/${env}/documents/combined?certificate=true`))).toBe(true);
    // DocuSign retries: a repeat does nothing
    expect(await (await connect("envelope-completed", env)).json()).toEqual({ status: "already executed" });
    expect((await m.db.query(`select count(*)::int n from docusign_event where envelope_id = $1`, [env]))[0].n).toBe(4);
  });

  it("rejects Connect messages without a valid HMAC signature", async () => {
    const { POST } = await import("@/app/api/docusign/connect/route");
    const raw = JSON.stringify({ event: "envelope-completed", data: { envelopeId: "env-2" } });
    const bad = await POST(new Request("https://cpp.example/api/docusign/connect", { method: "POST", body: raw, headers: { "x-docusign-signature-1": createHmac("sha256", "wrong").update(raw).digest("base64") } }));
    expect(bad.status).toBe(401);
    const none = await POST(new Request("https://cpp.example/api/docusign/connect", { method: "POST", body: raw }));
    expect(none.status).toBe(401);
  });

  it("returns a declined envelope to draft with the reason, and lets the PM void and resend", async () => {
    const no = await newContract();
    await m.contracts.prepareForSignature(seanA, no);
    const env = (await m.db.query(`select docusign_envelope_id e from contract where contract_number = $1`, [no]))[0].e;
    await connect("envelope-declined", env, { envelopeSummary: { recipients: { signers: [{ name: "Ray Ortiz", status: "declined", declinedReason: "Retainage should be 5%" }] } } });
    const k = (await m.db.query(`select status, signature_status, signature_note from contract where contract_number = $1`, [no]))[0];
    expect(k).toMatchObject({ status: "draft", signature_status: "declined" });
    expect(k.signature_note).toBe("Declined in DocuSign by Ray Ortiz: Retainage should be 5%");

    await m.contracts.prepareForSignature(seanA, no); // fixed and resent: a new envelope
    const env2 = (await m.db.query(`select docusign_envelope_id e from contract where contract_number = $1`, [no]))[0].e;
    expect(env2).not.toBe(env);
    await expect(m.contracts.voidSignature(seanA, no, "x")).rejects.toThrow(/reason/);
    await m.contracts.voidSignature(seanA, no, "Wrong start date");
    const put = ds.calls.filter((c) => c.method === "PUT").pop()!;
    expect(put.url).toContain(`/envelopes/${env2}`);
    expect(put.body).toEqual({ status: "voided", voidedReason: "Wrong start date" });
    expect((await m.db.query(`select status from contract where contract_number = $1`, [no]))[0].status).toBe("draft");
  });

  it("explains the one-time consent step when DocuSign asks for it", async () => {
    m.docusign.setDocusignFetch(async (u: any) => String(u).endsWith("/oauth/token") ? Response.json({ error: "consent_required" }, { status: 400 }) : Response.json({}));
    const no = await newContract();
    await expect(m.contracts.prepareForSignature(seanA, no)).rejects.toThrow(/one-time consent.*account-d\.docusign\.com\/oauth\/auth\?.*client_id=ik-test/);
    expect((await m.db.query(`select status from contract where contract_number = $1`, [no]))[0].status).toBe("draft");
    m.docusign.setDocusignFetch(ds.f);
  });
});
