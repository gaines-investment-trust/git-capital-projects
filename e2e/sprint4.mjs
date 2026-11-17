// Sprint 4 browser walkthrough: second bid, close bidding, leveling, gap analysis, award approvals, contract, execution.
// Run after e2e/smoke.mjs and e2e/sprint3.mjs on a clean database.
import { chromium } from "playwright-core";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "/tmp/gcp-shots";
const OUTBOX = process.env.OUTBOX ?? "/tmp/outbox";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const problems = [];
page.on("console", (m) => { if (m.type() === "error" && !/404|favicon|DevTools/.test(m.text())) problems.push(m.text()); });
page.on("pageerror", (e) => problems.push(String(e)));
const shot = (n, p = page) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true, caret: "initial" });
const step = (s) => console.log("•", s);
const pdf = "/tmp/gcp-test.pdf";
writeFileSync(pdf, "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

const signIn = async (p, email) => {
  await p.goto(`${BASE}/signin`);
  if (email) await p.fill('input[name="email"]', email);
  await p.getByRole("button", { name: "Sign in without Microsoft" }).click();
  await p.waitForURL(`${BASE}/`);
};

step("sign in");
await signIn(page);

step("Lone Star bids through its emailed link (excludes line 4)");
const mail = readdirSync(OUTBOX).filter((f) => f.includes("ray@lonestarroof.com")).sort().pop();
const link = readFileSync(join(OUTBOX, mail), "utf8").match(/https?:\/\/[^"'\s<]+\/portal\/[A-Za-z0-9_-]+/)[0].replace(/^https?:\/\/[^/]+/, BASE);
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const vp = await ctx.newPage();
vp.on("pageerror", (e) => problems.push("portal: " + e));
await vp.goto(link);
await vp.getByRole("button", { name: "Yes, we'll bid" }).click();
await vp.getByText("We've noted that you'll bid").waitFor();
for (const [no, amt] of Object.entries({ "1": "4000", "2": "290000", "5": "3000", "A1": "8000" })) await vp.getByLabel(`Amount line ${no}`).fill(amt);
await vp.getByLabel("Unit price line 3").fill("6.25");
await vp.getByLabel("Exclude line 4").check();
await vp.fill('input[name="scheduleDays"]', "50");
await vp.getByRole("button", { name: "Submit bid" }).click();
await vp.getByText(/Bid received \(version 1\)/).waitFor();
await ctx.close();

step("finish Lone Star's paperwork: W-9 and TX license (COI added in sprint 3)");
await page.goto(`${BASE}/vendors`);
await page.getByRole("link", { name: "Lone Star Roof Systems" }).first().click();
await page.waitForURL(/\/vendors\/[0-9a-f-]{36}$/);
await page.setInputFiles('input[name="file"]', pdf);
await page.getByRole("button", { name: "Upload W-9" }).click();
await page.getByRole("link", { name: "On file" }).waitFor();
await page.fill('input[name="state"]', "TX");
await page.fill('input[name="licenseNumber"]', "TX-RC-44812");
await page.getByRole("button", { name: "Add license" }).click();
await page.getByText("License · TX").waitFor();
await page.getByText("Paperwork complete").waitFor();
await shot("s4-1-vendor-complete");

step("close bidding; lands on leveling");
await page.goto(`${BASE}/rfps/RFP-TUS-001`);
await page.getByRole("button", { name: "Close bidding" }).click();
await page.waitForURL(/\/rfps\/RFP-TUS-001\/leveling$/);
await page.getByText("Bid leveling · 2 bids").waitFor();
await page.getByText("plug $12,000").waitFor();
await page.getByText("$6.25/SF").first().waitFor();
await page.locator("tr", { hasText: "Paperwork" }).getByText("Complete", { exact: true }).waitFor();
const leveled = page.locator("tr", { hasText: "Leveled total" });
await leveled.getByText("$309,000").waitFor();   // Lone Star 297,000 base + 12,000 plug for excluded line 4
await leveled.getByText("$320,500").waitFor();
await shot("s4-2-leveling");

step("toggle alternate A1 into the comparison");
await page.getByRole("link", { name: /Alternate A1/ }).click();
await page.waitForURL(/alt=/);
await leveled.getByText("$329,500").waitFor();

step("gap analysis and a clarification email");
await page.getByRole("button", { name: "Run gap analysis" }).click();
await page.getByText(/\d+ findings? \(rules/).waitFor({ timeout: 30000 });
await page.reload();
await page.getByText(/excluded/i).first().waitFor();
await page.locator("summary", { hasText: "Lone Star Roof Systems" }).click();
await page.getByRole("button", { name: "Send from my Outlook" }).click();
await page.getByText("Sent to Lone Star Roof Systems").waitFor();
await shot("s4-3-gaps");

step("Lone Star answers with a revised bid pricing line 4 (version 2)");
const rctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const rp = await rctx.newPage();
rp.on("pageerror", (e) => problems.push("portal v2: " + e));
await rp.goto(link);
await rp.getByLabel("Exclude line 4").uncheck();
await rp.getByLabel("Amount line 4").fill("11000");
await rp.getByRole("button", { name: "Submit bid" }).click();
await rp.getByText(/Bid received \(version 2\)/).waitFor();
await rctx.close();
await page.reload();
await page.getByText("v2").first().waitFor();
await leveled.getByText("$316,000").waitFor();   // 308,000 base + 8,000 alternate A1

step("request the award to the lowest compliant bidder (Lone Star)");
await page.fill('textarea[name="memo"]', "Lowest leveled bid with complete paperwork; gutters priced in the revised bid after clarification. Includes alternate A1.");
await page.getByRole("button", { name: "Send award for approval" }).click();
await page.getByText(/pending approval · contract value \$316,000 · alternates A1/).waitFor();
await page.getByText("awaiting account").waitFor();

step("COO approves from the inbox");
await page.goto(`${BASE}/`);
await page.getByRole("button", { name: "Approve" }).first().click();
await page.getByText(/Approved/).first().waitFor();

step("add the President, who then approves");
await page.goto(`${BASE}/admin/people`);
await page.fill('input[name="displayName"]', "Jeff Gaines");
await page.fill('input[name="email"]', "jeffg@gainesinvestmenttrust.com");
await page.selectOption('select[name="roleCode"]', "executive");
await page.selectOption('select[name="scopeKind"]', "all");
await page.getByRole("button", { name: /Add person|Save/ }).click();
await page.getByText("jeffg@gainesinvestmenttrust.com").first().waitFor();
const pctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const pp = await pctx.newPage();
pp.on("pageerror", (e) => problems.push("president: " + e));
await signIn(pp, "jeffg@gainesinvestmenttrust.com");
await pp.getByText("Award").first().waitFor();
await shot("s4-4-president-inbox", pp);
await pp.getByRole("button", { name: "Approve" }).first().click();
await pp.getByText(/Final approval recorded/).waitFor();
await pctx.close();

step("contract K01 exists with the SOV from the bid");
await page.goto(`${BASE}/rfps/RFP-TUS-001/leveling`);
await page.getByRole("link", { name: /Open contract TUS-26-001-K01/ }).click();
await page.waitForURL(/\/contracts\/TUS-26-001-K01$/);
await page.getByText("Lone Star Roof Systems").first().waitFor();
await page.getByText("Draft", { exact: true }).waitFor();
await shot("s4-5-contract-draft");

step("generate for signature, download the draft");
await page.getByRole("button", { name: "Generate contract for signature" }).click();
await page.getByText("Out for signature", { exact: true }).waitFor({ timeout: 30000 });
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: /Contract-Draft.*\.docx/ }).click()]);
if (!(await dl.suggestedFilename()).endsWith(".docx")) problems.push("draft download is not a .docx");

step("upload the signed PDF; contract executes and commits the budget");
await page.setInputFiles('input[name="file"]', pdf);
await page.getByRole("button", { name: "Record as executed" }).click();
await page.getByText("Executed", { exact: true }).waitFor({ timeout: 30000 });
await page.getByRole("link", { name: /Contract-Executed.*\.pdf/ }).waitFor();
await shot("s4-6-contract-executed");

step("project shows the contract; regrets go to the other bidder");
await page.goto(`${BASE}/projects/TUS-26-001`);
await page.locator("tr", { hasText: "TUS-26-001-K01" }).getByText("executed").waitFor();
await page.goto(`${BASE}/rfps/RFP-TUS-001/leveling`);
await page.getByRole("button", { name: "Send regret letters" }).click();
await page.getByText("Sent 1 regret letter").waitFor();

await browser.close();
if (problems.length) { console.log("BROWSER ERRORS:\n" + problems.join("\n")); process.exit(1); }
console.log("SPRINT4 OK");
