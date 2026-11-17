// End-to-end smoke test of sprint 1 in a real browser against `next dev` with development sign-in.
// Usage: BASE=http://localhost:3000 CHROME=/usr/bin/google-chrome node e2e/smoke.mjs
import { chromium } from "playwright-core";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "/tmp/gcp-shots";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const problems = [];
page.on("console", (m) => { if (m.type() === "error" && !/404|favicon|DevTools/.test(m.text())) problems.push(m.text()); });
page.on("pageerror", (e) => problems.push(String(e)));
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });
const step = (s) => console.log("•", s);

step("sign in");
await page.goto(`${BASE}/`);
await page.waitForURL(/signin/);
await page.getByRole("button", { name: "Sign in without Microsoft" }).click();
await page.waitForURL(`${BASE}/`);
await page.getByText("Hello, Joe").waitFor();
await shot("1-home-empty");

step("add properties");
await page.goto(`${BASE}/admin/properties`);
for (const [code, name, state] of [["TUS", "Tuscany Square", "TX"], ["MON", "Montfort Place", "TX"]]) {
  await page.fill('input[name="code"]', code);
  await page.fill('input[name="name"]', name);
  await page.selectOption('select[name="state"]', state);
  await page.getByRole("button", { name: "Add property" }).click();
  await page.getByText("Property added").waitFor();
  await page.getByRole("cell", { name: code, exact: true }).waitFor();
}
await shot("2-properties");

step("create project");
await page.goto(`${BASE}/projects/new`);
await page.selectOption('select[name="propertyId"]', { label: "TUS · Tuscany Square (TX)" });
await page.selectOption('select[name="projectTypeCode"]', "roof");
await page.fill('input[name="name"]', "Building 1-8 roof replacement");
await page.fill('input[name="plannedStart"]', "2026-12-07");
await page.fill('input[name="plannedEnd"]', "2027-03-05");
await page.fill('input[name="budgetAmount"]', "412000");
await page.getByRole("button", { name: "Create project" }).click();
await page.waitForURL(/\/projects\/TUS-26-001/, { timeout: 30000 });
await page.getByText("Project TUS-26-001 created.").first().waitFor();
await page.getByRole("cell", { name: "Dec 7, 2026" }).first().waitFor();
await page.locator("tr", { hasText: "07-310 Roofing" }).getByText("$412,000").first().waitFor();
await shot("3-project");

step("upload and file a document");
writeFileSync("/tmp/vendor-proposal.pdf", "%PDF-1.4 sample bid");
await page.setInputFiles('input[name="file"]', "/tmp/vendor-proposal.pdf");
await page.selectOption('select[name="docType"]', "Bid");
await page.fill('input[name="party"]', "Brandpoint Roofing LLC");
await page.fill('input[name="docDate"]', "2026-11-20");
await page.getByRole("button", { name: "Upload and file" }).click();
await page.getByText("Filed as TUS-26-001_Bid_BrandpointRoofing_2026-11-20_v1.pdf").waitFor({ timeout: 20000 });
await shot("4-filed");

step("home shows the project");
await page.goto(`${BASE}/`);
await page.getByRole("link", { name: "TUS-26-001" }).waitFor();
await shot("5-home");

step("people page");
await page.goto(`${BASE}/admin/people`);
await page.getByText("joeg@gainesinvestmenttrust.com").waitFor();
await shot("6-people");

step("phone width");
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/projects/TUS-26-001`);
await shot("7-phone-project");

await browser.close();
if (problems.length) { console.log("BROWSER ERRORS:\n" + problems.join("\n")); process.exit(1); }
console.log("SMOKE OK");
