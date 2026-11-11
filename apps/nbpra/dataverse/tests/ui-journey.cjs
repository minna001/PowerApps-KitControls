#!/usr/bin/env node
// Browser test: loads the single-file build of the React app in headless
// Chromium and drives one submission through the whole journey in the UI,
// against a real environment. No server is started: the page's requests are
// intercepted in this process and answered from Dataverse with the script's
// sign-in. It CREATES a real submission ("UI journey …").
// Build first: (cd ../codeapp && npm run build:webresource).
//
//   DV_TOKEN_FILE=<file> NODE_USE_ENV_PROXY=1 node tests/ui-journey.cjs --url https://<org>.crm.dynamics.com --out <screenshot dir>
const { chromium } = require("playwright");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const args = process.argv.slice(2);
const arg = (n) => args[args.indexOf(n) + 1];
const org = (arg("--url") || "").replace(/\/$/, "");
const out = arg("--out");
const cache = JSON.parse(readFileSync(process.env.DV_TOKEN_FILE, "utf8"));
if (!org || !out || cache.url !== org || cache.expires < Date.now()) {
  console.error("Needs --url, --out and a current DV_TOKEN_FILE for that org.");
  process.exit(1);
}
const html = readFileSync(join(__dirname, "../../codeapp/dist-webresource/index.html"), "utf8");
const ORIGIN = "http://nbpra.test"; // never resolved; every request is intercepted

(async () => {
  const log = [];
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
  await p.route(ORIGIN + "/**", async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (!u.pathname.startsWith("/api/data/")) return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
    try {
      const r = await fetch(org + u.pathname + u.search, {
        method: req.method(),
        headers: { Authorization: `Bearer ${cache.token}`, Accept: "application/json", "Content-Type": "application/json", "OData-Version": "4.0" },
        body: req.postData() ?? undefined,
      });
      await route.fulfill({ status: r.status, contentType: "application/json", body: (await r.text()).replaceAll(org, ORIGIN) });
    } catch (e) {
      await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: { message: String(e.message) } }) });
    }
  });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 200)));
  p.on("dialog", (d) => d.accept("Returned by the UI journey test."));
  const U = ORIGIN + "/";
  const shot = async (n) => {
    await p.waitForTimeout(700);
    await p.screenshot({ path: `${out}/${n}.png` });
  };
  let failed = 0;
  const step = async (name, fn) => {
    try {
      await fn();
      log.push("ok   " + name);
    } catch (e) {
      failed++;
      log.push("FAIL " + name + ": " + e.message.split("\n")[0].slice(0, 200));
      await p.screenshot({ path: `${out}/FAIL-${name.replace(/\W+/g, "-")}.png` }).catch(() => {});
    }
  };
  const T = 45000;
  const title = "UI journey " + new Date().toISOString().slice(11, 19);
  const fillSection = async () => {
    await p.waitForSelector(".cl-body .fui-Field", { timeout: T });
    for (const ta of await p.locator(".cl-body textarea").all()) await ta.fill("Journey test answer.");
    for (const n of await p.locator(".cl-body input[type=number]").all()) await n.fill("0");
    for (const d of await p.locator(".cl-body input[type=date]").all()) await d.fill("2027-03-01");
    for (const s of await p.locator(".cl-body select").all()) await s.selectOption({ index: 1 });
    for (const g of await p.locator(".cl-body [role=radiogroup]").all()) await g.getByLabel("No").check();
  };
  const submitSection = async () => {
    await p.getByRole("button", { name: "Submit section for review" }).click();
    await p.waitForSelector('.cl-head :text("Under Review")', { timeout: T });
  };

  await step("home", async () => {
    await p.goto(U);
    await p.waitForSelector(".tiles", { timeout: T });
    await p.waitForSelector(".register, .empty-card", { timeout: T });
    await shot("01-home");
  });
  await step("calendar", async () => {
    await p.click('a:has-text("Start a new submission")');
    await p.waitForSelector(".slot.open", { timeout: T });
    await shot("02-calendar");
  });
  await step("pick a slot", async () => {
    await p.locator(".slot.open").last().click();
    await p.waitForSelector("text=Initial onboarding");
    await p.waitForSelector(".form-grid .next-title", { timeout: T });
  });
  await step("empty onboarding is refused", async () => {
    await p.getByRole("button", { name: "Submit request" }).click();
    await p.waitForSelector(".notice.bad", { timeout: T });
    log.push("     " + (await p.locator(".notice.bad").innerText()).slice(0, 170));
  });
  await step("fill onboarding", async () => {
    await p.getByLabel("Proposal title").fill(title);
    await p.getByLabel("Business area").selectOption("Payments");
    await p.getByLabel("Proposal classification").selectOption("New product");
    await p.getByLabel("Brief business description").fill("Created by the browser journey test.");
    await p.getByLabel("Indicative jurisdictions and scope").fill("United States");
    for (let i = 1; i <= 5; i++) await p.getByLabel(new RegExp("^Signatory " + i)).selectOption({ index: 1 });
    await shot("03-onboarding");
  });
  await step("submit onboarding", async () => {
    await p.getByRole("button", { name: "Submit request" }).click();
    await p.waitForSelector('.ws-badges :text("Awaiting Onboarding Review")', { timeout: T });
    await shot("04-awaiting-onboarding");
  });
  await step("administrator approves onboarding", async () => {
    await p.getByRole("button", { name: "Approve and unlock checklist" }).click();
    await p.waitForSelector('.ws-badges :text("Checklist in Progress")', { timeout: T });
  });
  await step("open checklist", async () => {
    await p.getByRole("tab", { name: "Checklist" }).click();
    await p.waitForSelector(".cl-body .fui-Field", { timeout: T });
    await shot("05-checklist");
  });
  await step("fill and submit the first section", async () => {
    await fillSection();
    await shot("06-checklist-filled");
    await submitSection();
  });
  await step("fill and submit the other sections", async () => {
    const n = await p.locator(".cl-item").count();
    for (let i = 1; i < n; i++) {
      await p.locator(".cl-item").nth(i).click();
      await p.waitForSelector(".cl-head .section-title", { timeout: T });
      await p.waitForTimeout(500);
      await fillSection();
      await submitSection();
    }
    await shot("07-all-under-review");
  });
  const mine = () => p.locator(".stack .panel", { hasText: title });
  await step("reviewer returns one section", async () => {
    await p.goto(U + "#/approvals");
    await p.waitForSelector(".task-row", { timeout: T });
    await shot("08-approvals");
    await mine().first().getByRole("button", { name: "Review" }).click();
    await p.waitForSelector(".answers", { timeout: T });
    await shot("09-review-open");
    await p.locator(".review textarea").fill("Please expand the description.");
    await p.getByRole("button", { name: "Request changes" }).click();
    await p.waitForSelector(".notice.good", { timeout: T });
  });
  await step("reviewer approves the rest", async () => {
    for (let guard = 0; guard < 12; guard++) {
      await p.waitForTimeout(900);
      if (!(await mine().filter({ has: p.getByRole("button", { name: "Review" }) }).count())) break;
      await mine().filter({ has: p.getByRole("button", { name: "Review" }) }).first().getByRole("button", { name: "Review" }).click();
      await p.waitForSelector(".answers", { timeout: T });
      await p.getByRole("button", { name: "Approve section" }).click();
      await p.waitForFunction(() => !document.querySelector(".answers"), null, { timeout: T });
    }
  });
  let subUrl;
  await step("submitter corrects the returned section", async () => {
    await p.goto(U + "#/mine");
    await p.waitForSelector(".register tbody tr", { timeout: T });
    await p.click(`a.row-title:has-text("${title}")`);
    await p.waitForSelector(".rail", { timeout: T });
    subUrl = p.url();
    await p.getByRole("tab", { name: "Checklist" }).click();
    await p.waitForSelector(".cl-body .notice.bad", { timeout: T });
    await shot("10-section-returned");
    await p.locator(".cl-body textarea").first().fill("Expanded description after reviewer feedback.");
    await submitSection();
  });
  await step("reviewer approves the corrected section", async () => {
    await p.goto(U + "#/approvals");
    await p.waitForSelector(".task-row", { timeout: T });
    await mine().first().getByRole("button", { name: "Review" }).click();
    await p.waitForSelector(".answers", { timeout: T });
    await p.getByRole("button", { name: "Approve section" }).click();
    await p.waitForSelector(".notice.good", { timeout: T });
  });
  await step("request signatory approval", async () => {
    await p.goto(subUrl);
    await p.waitForSelector(".rail", { timeout: T });
    await p.getByRole("button", { name: "Request signatory approval" }).click();
    await p.waitForSelector('.ws-badges :text("Awaiting Signatory Approval")', { timeout: T });
    await shot("11-awaiting-signatories");
  });
  await step("five signatory approvals", async () => {
    await p.goto(U + "#/approvals");
    await p.waitForSelector(".task-row", { timeout: T });
    for (let i = 0; i < 5; i++) {
      await mine().first().getByRole("button", { name: "Approve", exact: true }).click();
      await p.waitForSelector(".notice.good", { timeout: T });
      await p.waitForTimeout(1200);
    }
    await shot("12-signatories-done");
  });
  await step("final submission", async () => {
    await p.goto(subUrl);
    await p.waitForSelector(".rail", { timeout: T });
    await p.getByRole("button", { name: "Make final submission" }).click();
    await p.waitForSelector('.ws-badges :text("Awaiting Final Admin Review")', { timeout: T });
  });
  await step("administrator authorizes committee attendance", async () => {
    await p.getByRole("button", { name: "Authorize committee attendance" }).click();
    await p.waitForSelector('.ws-badges :text("Authorized for Committee")', { timeout: T });
    await shot("13-authorized");
    await p.getByRole("tab", { name: "Timeline" }).click();
    await shot("14-timeline");
  });
  await step("phone-width calendar has no sideways scroll", async () => {
    await p.setViewportSize({ width: 420, height: 800 });
    await p.goto(U + "#/calendar");
    await p.waitForSelector(".slot", { timeout: T });
    if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error("page overflows");
  });
  console.log(log.join("\n"));
  console.log("console errors:", JSON.stringify(errs.slice(0, 5)));
  await b.close();
  process.exit(failed ? 1 : 0);
})();
