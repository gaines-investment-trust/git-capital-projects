// Sprint 3 browser walkthrough. Run after e2e/smoke.mjs (needs project TUS-26-001).
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "/tmp/gcp-shots";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const problems = [];
page.on("console", (m) => { if (m.type() === "error" && !/404|favicon|DevTools/.test(m.text())) problems.push(m.text()); });
page.on("pageerror", (e) => problems.push(String(e)));
const shot = (n, p = page) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true, caret: "initial" });
const step = (s) => console.log("•", s);

step("sign in");
await page.goto(`${BASE}/signin`);
await page.getByRole("button", { name: "Sign in without Microsoft" }).click();
await page.waitForURL(`${BASE}/`);

step("add two vendors");
for (const [name, email, trades] of [["Brandpoint Roofing LLC", "dana@brandpointroofing.com", "roofing, gutters"], ["Lone Star Roof Systems", "ray@lonestarroof.com", "roofing"]]) {
  await page.goto(`${BASE}/vendors`);
  await page.getByRole("button", { name: "+ Add vendor" }).click();
  await page.fill('input[name="name"]', name);
  await page.fill('input[name="trades"]', trades);
  await page.fill('input[name="statesServed"]', "TX");
  await page.fill('input[name="contactName"]', name.split(" ")[0] + " contact");
  await page.fill('input[name="contactEmail"]', email);
  await page.getByRole("button", { name: "Save vendor" }).click();
  await page.waitForURL(/\/vendors\/[0-9a-f-]{36}$/);
  await page.getByText(/paperwork items? missing/).waitFor();
}
await page.fill('input[name="expiresOn"]', "2027-06-30");
await page.getByRole("button", { name: "Add COI" }).click();
await page.getByText("2027-06-30").first().waitFor();
await shot("s3-1-vendor");

step("start an RFP from the project");
await page.goto(`${BASE}/projects/TUS-26-001`);
await page.getByRole("button", { name: "+ New RFP" }).click();
await page.waitForURL(/\/rfps\/RFP-TUS-001$/);
await page.getByText("Scope summary is missing").waitFor();

step("fill scope and dates; package check clears");
await page.fill('textarea[name="summary"]', "Tear off and replace the roofing system on buildings 1 through 8, with deck repairs where rot is found.");
await page.fill('textarea[name="items"]', "1. Remove existing shingles and underlayment\n2. Install ice and water shield and synthetic underlayment\n3. Install architectural shingles and ridge vents");
await page.getByRole("button", { name: "Save scope" }).click();
await page.getByText("Saved").first().waitFor();
const inDays = (d, hh) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10) + `T${hh}`;
await page.fill('input[name="siteWalkAt"]', inDays(5, "10:00"));
await page.fill('input[name="questionsDueAt"]', inDays(9, "17:00"));
await page.fill('input[name="bidDueAt"]', inDays(16, "14:00"));
await page.getByRole("button", { name: "Save dates" }).click();
await page.getByText("Saved", { exact: true }).nth(1).waitFor();
await page.reload();
await page.getByText("Must fix").waitFor({ state: "detached" });
await shot("s3-2-rfp-draft");

step("submit for approval, approve from the inbox");
await page.getByRole("button", { name: "Submit for approval" }).click();
await page.getByText("Waiting for approval", { exact: true }).waitFor();
await page.goto(`${BASE}/`);
await page.getByText("RFP to bid").waitFor();
await shot("s3-3-inbox");
await page.getByRole("button", { name: "Approve" }).first().click();
await page.getByText("Approved. Final approval recorded.").waitFor();

step("issue the RFP");
await page.goto(`${BASE}/rfps/RFP-TUS-001`);
await page.getByRole("button", { name: /Issue RFP/ }).click();
await page.getByText("Issued, collecting bids", { exact: true }).waitFor({ timeout: 30000 });
await page.getByText(/^TUS-26-001_RFP_GIT_\d{4}-\d{2}-\d{2}_v1\.docx/).waitFor();
await page.getByText(/^TUS-26-001_BidForm_GIT_\d{4}-\d{2}-\d{2}_v1\.xlsx/).waitFor();

step("invite both vendors");
await page.reload();
await page.getByLabel("Invite Brandpoint Roofing LLC").check();
await page.getByLabel("Invite Lone Star Roof Systems").check();
await page.getByRole("button", { name: "Send invitations from my Outlook" }).click();
await page.getByText("Invitations processed").waitFor({ timeout: 30000 });
const detail = await page.locator("span.small", { hasText: "Brandpoint Roofing LLC: sent to local outbox" }).textContent();
const link = detail.match(/https?:\/\/\S+\/portal\/[A-Za-z0-9_-]+/)[0].replace(/^https?:\/\/[^/]+/, BASE);
await shot("s3-4-invited");

step("vendor portal: will bid, ask, submit bid (no staff sign-in)");
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const vp = await ctx.newPage();
vp.on("pageerror", (e) => problems.push("portal: " + e));
await vp.goto(link);
await vp.getByText("Brandpoint Roofing LLC").first().waitFor();
await vp.getByRole("button", { name: "Yes, we'll bid" }).click();
await vp.getByText("We've noted that you'll bid").waitFor();
await vp.fill('textarea[name="question"]', "Are permits by owner or contractor?");
await vp.getByRole("button", { name: "Send question" }).click();
await vp.getByText("Question sent").waitFor();
const amounts = { "1": "5000", "2": "300000", "4": "12000", "5": "3500", "A1": "9000" };
for (const [no, amt] of Object.entries(amounts)) await vp.getByLabel(`Amount line ${no}`).fill(amt);
await vp.getByLabel("Unit price line 3").fill("6.50");
await vp.getByText("Base bid total: $320,500.00").waitFor();
await vp.fill('input[name="scheduleDays"]', "45");
await vp.getByRole("button", { name: "Submit bid" }).click();
await vp.getByText(/Bid received \(version 1\)\. Base total \$320,500\.00/).waitFor();
await shot("s3-5-portal-phone", vp);
await vp.goto(`${BASE}/portal/not-a-real-token`);
await vp.getByText("Link not available").waitFor();
await ctx.close();

step("staff see the bid and answer the question");
await page.goto(`${BASE}/rfps/RFP-TUS-001`);
await page.locator("tr", { hasText: "Brandpoint Roofing LLC" }).getByText("$320,500").waitFor();
await page.locator("tr", { hasText: "Brandpoint Roofing LLC" }).getByText("Will bid").waitFor();
await page.fill('input[name="answer"]', "Contractor pulls and pays for permits.");
await page.getByRole("button", { name: "Publish answer" }).click();
await page.getByText(/Contractor pulls and pays for permits\..*published/).waitFor();
await shot("s3-6-rfp-bids");

await browser.close();
if (problems.length) { console.log("BROWSER ERRORS:\n" + problems.join("\n")); process.exit(1); }
console.log("SPRINT3 OK");
