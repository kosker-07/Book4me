// Browser test for the admin UI at /app (real Chromium via Playwright).
// Catches what the server tests cannot: JavaScript that fails to parse or
// throws in the browser. Both of these locked staging logins on 2026-11-08.
//
// Env: BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD (the server bootstraps this admin).
import { chromium, devices } from "playwright";
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3999";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
assert.ok(EMAIL && PASSWORD, "ADMIN_EMAIL and ADMIN_PASSWORD are required");

// Admin pages that load data from the API; each must open without an error.
const ADMIN_PAGES = ["dashboard", "bookings", "hotels", "markets", "agencies", "currencies", "platform-settings", "distribution", "account"];

function watchErrors(page, allowConsole) {
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => {
    if (m.type() !== "error" || (allowConsole && allowConsole.test(m.text()))) return;
    errors.push("console: " + m.text());
  });
  page.on("requestfailed", r => errors.push("requestfailed: " + r.url()));
  return errors;
}

async function toastText(page) {
  const toast = page.getByTestId("error-message");
  return (await toast.isVisible()) ? (await toast.textContent()).trim() : "";
}

async function signIn(page, email, password) {
  await page.goto(BASE + "/app/");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
}

async function run(name, contextOptions, body, allowConsole) {
  const browser = await chromium.launch();
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = watchErrors(page, allowConsole);
  try {
    await body(page);
    assert.deepEqual(errors, [], `${name}: browser errors`);
    console.log(`ok - ${name}`);
  } catch (e) {
    await page.screenshot({ path: `e2e-${name.replace(/\W+/g, "-")}.png`, fullPage: true }).catch(() => {});
    console.log(`not ok - ${name}`);
    throw e;
  } finally {
    await browser.close();
  }
}

// 1) Wrong password: a readable error, the login form stays.
await run("wrong password shows an error", {}, async page => {
  await signIn(page, EMAIL, PASSWORD + "-wrong");
  await page.getByTestId("error-message").waitFor({ state: "visible" });
  assert.match(await toastText(page), /E-posta veya şifre hatalı/);
  assert.equal(await page.locator("#app").isVisible(), false);
  assert.equal(await page.locator("#login").isVisible(), true);
}, /status of 401/); // the browser logs the rejected login request itself

// 2) Desktop: login opens the dashboard and every admin page loads cleanly.
await run("desktop admin login and pages", { viewport: { width: 1366, height: 900 } }, async page => {
  await signIn(page, EMAIL, PASSWORD);
  await page.locator("#app").waitFor({ state: "visible" });
  assert.equal(await page.locator("#login").isVisible(), false);
  await page.waitForLoadState("networkidle");
  assert.equal((await page.locator("#pageTitle").textContent()).trim(), "Panel");
  assert.equal(await toastText(page), "", "no error toast after login");

  for (const id of ADMIN_PAGES) {
    await page.getByTestId("nav-" + id).click();
    await page.waitForLoadState("networkidle");
    const toast = await toastText(page);
    assert.ok(!/İşlem başarısız|Yetkiniz yok|Bağlantı hatası/.test(toast), `${id}: error toast "${toast}"`);
    assert.equal(await page.getByText("Veri yüklenemedi.").count(), 0, `${id}: data failed to load`);
  }

  // A page reload keeps the user signed in.
  await page.reload();
  await page.locator("#app").waitFor({ state: "visible" });
  assert.equal(await page.locator("#login").isVisible(), false, "reload must not sign the user out");
  await page.waitForLoadState("networkidle");
  assert.equal(await toastText(page), "", "no error toast after reload");

  await page.locator("#logout").click();
  await page.locator("#login").waitFor({ state: "visible" });
  // After logout a reload stays on the login form.
  await page.reload();
  await page.locator("#login").waitFor({ state: "visible" });
  await page.waitForLoadState("networkidle");
  assert.equal(await page.locator("#app").isVisible(), false, "logout must survive a reload");
});

// 3) Phone: the same login works and the menu opens from the menu button.
await run("mobile admin login and menu", { ...devices["iPhone 13"] }, async page => {
  await signIn(page, EMAIL, PASSWORD);
  await page.locator("#app").waitFor({ state: "visible" });
  await page.waitForLoadState("networkidle");
  assert.equal(await toastText(page), "", "no error toast after login");
  await page.locator("#menuToggle").click();
  await page.getByTestId("nav-hotels").waitFor({ state: "visible" });
  await page.getByTestId("nav-hotels").click();
  await page.waitForLoadState("networkidle");
  assert.equal(await page.getByText("Veri yüklenemedi.").count(), 0);
});

console.log("all browser checks passed");
