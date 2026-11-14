// B4B-JARVIS-VERIFY-001 — T15 browser E2E for the hotel / room / rate plan / calendar UI.
// Real Chromium against the compiled server (same harness as admin-login.e2e.mjs).
//
// Env: BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD (the server bootstraps this admin).
import { chromium } from "playwright";
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3999";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
assert.ok(EMAIL && PASSWORD, "ADMIN_EMAIL and ADMIN_PASSWORD are required");

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", e => errors.push("pageerror: " + e.message));
page.on("console", m => {
  // Expected by design: the delete-guard 409 and the post-delete existence check 404.
  if (m.type() === "error" && !/status of (404|409)/.test(m.text())) errors.push("console: " + m.text());
});
page.on("requestfailed", r => errors.push("requestfailed: " + r.url()));

// The toast is the single success/error channel: saves confirm with "Kaydedildi." and failures
// render the server message. Any other text means the UI reported an error.
const toastText = async () => {
  const toast = page.getByTestId("error-message");
  return (await toast.isVisible()) ? (await toast.textContent()).trim() : "";
};
const expectSaved = async (what) => {
  const text = await toastText();
  assert.ok(text === "Kaydedildi." || text === "", `unexpected toast after ${what}: ${text}`);
};
const expectNoError = async (what) => {
  const text = await toastText();
  assert.equal(text, "", `unexpected toast after ${what}`);
};
const cardWith = title => page.locator("section.card").filter({ hasText: title }).first();

try {
  await page.goto(BASE + "/app/");
  await page.getByTestId("login-email").fill(EMAIL);
  await page.getByTestId("login-password").fill(PASSWORD);
  await page.getByTestId("login-submit").click();
  await page.locator("#app").waitFor({ state: "visible" });
  await page.waitForLoadState("networkidle");

  // A hotel must belong to a master agency; create one inside the signed-in session.
  const dmcName = "E2E Hotel DMC " + Date.now();
  const dmc = await page.evaluate(async name => {
    const r = await fetch("/api/admin/agencies", { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Requested-With": "bed4book" }, body: JSON.stringify({ name, type: "master" }) });
    return { status: r.status, body: await r.json() };
  }, dmcName);
  assert.equal(dmc.status, 201, "master agency created: " + JSON.stringify(dmc.body));

  // Hotels page → create a hotel through the form.
  await page.getByTestId("nav-hotels").click();
  await page.waitForLoadState("networkidle");
  const hotelName = "E2E Otel " + Date.now();
  const hotelForm = cardWith("Yeni otel").locator("form");
  await hotelForm.locator('input[name="name"]').fill(hotelName);
  await hotelForm.locator('input[name="location"]').fill("İstanbul");
  await hotelForm.locator('select[name="ownerAgencyId"]').selectOption({ label: dmcName });
  await hotelForm.locator('button[type="submit"]').click();
  await page.waitForLoadState("networkidle");

  const hotelRow = page.locator('tr[data-testid^="hotel-row-"]').filter({ hasText: hotelName }).first();
  await hotelRow.waitFor({ state: "visible" });
  await expectSaved("hotel create");
  const hotelId = (await hotelRow.getAttribute("data-testid")).replace("hotel-row-", "");

  // Hotel detail → create a room.
  await page.getByTestId("hotel-manage-" + hotelId).click();
  await page.waitForLoadState("networkidle");
  const roomName = "Standart Oda " + Date.now();
  const roomForm = cardWith("Yeni oda").locator("form");
  await roomForm.locator('input[name="name"]').fill(roomName);
  await roomForm.locator('input[name="description"]').fill("E2E oda açıklaması");
  await roomForm.locator('input[name="maxAdults"]').fill("2");
  await roomForm.locator('input[name="maxChildren"]').fill("1");
  await roomForm.locator('button[type="submit"]').click();
  await page.waitForLoadState("networkidle");
  await cardWith("Oda · " + roomName).waitFor({ state: "visible" });
  await expectSaved("room create");

  // A rate plan needs a contract of the same hotel and currency.
  const contractCode = "E2E-" + Date.now();
  const contractName = "E2E Kontrat " + Date.now();
  const contractForm = cardWith("Yeni kontrat").locator("form");
  await contractForm.locator('input[name="code"]').fill(contractCode);
  await contractForm.locator('input[name="name"]').fill(contractName);
  await contractForm.locator('input[name="currency"]').fill("EUR");
  await contractForm.locator('input[name="sellerLegalName"]').fill("E2E Seller A.Ş.");
  await contractForm.locator('button[type="submit"]').click();
  await page.waitForLoadState("networkidle");
  await expectSaved("contract create");

  // Create a rate plan on the new room.
  const board = "Half Board " + Date.now();
  await cardWith("Oda · " + roomName).locator('button[data-testid^="room-rate-add-"]').first().click();
  await page.waitForLoadState("networkidle");
  const planForm = cardWith("Yeni fiyat planı").locator("form");
  await planForm.locator('input[name="boardName"]').fill(board);
  await planForm.locator('input[name="currency"]').fill("EUR");
  await planForm.locator('select[name="contractId"]').selectOption({ label: contractName });
  await planForm.locator('button[type="submit"]').click();
  await page.waitForLoadState("networkidle");
  await cardWith("Fiyat planı · " + board).waitFor({ state: "visible" });
  await expectSaved("rate plan create");

  // Calendar: save a nightly net price and an allotment, then read them back.
  await cardWith("Fiyat planı · " + board).locator('button[data-testid^="plan-calendar-"]').first().click();
  await page.waitForLoadState("networkidle");
  const calendarForm = cardWith("Tarih aralığı güncelle").locator("form");
  await calendarForm.locator('input[name="price"]').fill("100");
  await calendarForm.locator('input[name="allotment"]').fill("5");
  await calendarForm.locator('button[type="submit"]').click();
  await page.waitForLoadState("networkidle");
  await expectSaved("calendar update");
  // The page re-fetches the range after saving; wait for the new values instead of racing it.
  const calendarPre = page.locator("section.card pre").first();
  await calendarPre.filter({ hasText: '"price": "100.00"' }).waitFor({ state: "visible", timeout: 15000 });
  const calendarText = await calendarPre.textContent();
  assert.match(calendarText, /"price": "100\.00"/, "calendar shows the saved nightly price");
  assert.match(calendarText, /"allotment": 5/, "calendar shows the saved allotment");

  // J2: a non-empty hotel must be refused with a readable reason, never silently cascaded.
  await page.getByTestId("nav-hotels").click();
  await page.waitForLoadState("networkidle");
  await page.getByTestId("hotel-delete-" + hotelId).click();
  await page.locator("div.notice button").first().click();
  const refusal = page.getByTestId("error-message");
  await refusal.filter({ hasText: "Otel silinemez" }).waitFor({ state: "visible", timeout: 20000 });
  const refusalText = await refusal.textContent();
  assert.match(refusalText, /kontrat/, `refusal names the blocker, got: ${refusalText}`);
  assert.equal(await page.locator(`tr[data-testid="hotel-row-${hotelId}"]`).count(), 1, "hotel survives the refused delete");

  // A second, empty hotel proves the success path still works through the same button.
  await page.getByTestId("nav-hotels").click();
  const emptyForm = cardWith("Yeni otel").locator("form");
  await emptyForm.waitFor({ state: "visible" });
  const emptyName = "E2E Boş Otel " + Date.now();
  await emptyForm.locator('input[name="name"]').fill(emptyName);
  await emptyForm.locator('input[name="location"]').fill("Ankara");
  await emptyForm.locator('select[name="ownerAgencyId"]').selectOption({ label: dmcName });
  await emptyForm.locator('button[type="submit"]').click();
  const emptyRow = page.locator('tr[data-testid^="hotel-row-"]').filter({ hasText: emptyName }).first();
  await emptyRow.waitFor({ state: "visible" });
  const emptyId = (await emptyRow.getAttribute("data-testid")).replace("hotel-row-", "");
  await page.getByTestId("hotel-delete-" + emptyId).click();
  await page.locator("div.notice button").first().click();
  await page.locator(`tr[data-testid="hotel-row-${emptyId}"]`).waitFor({ state: "detached", timeout: 20000 });
  const gone = await page.evaluate(async id => {
    const r = await fetch("/api/admin/hotels/" + id, { credentials: "same-origin", headers: { "X-Requested-With": "bed4book" } });
    return r.status;
  }, emptyId);
  assert.equal(gone, 404, "deleted empty hotel no longer exists");
  // And the non-empty hotel is still there, untouched.
  assert.equal(await page.evaluate(async id => (await fetch("/api/admin/hotels/" + id, { credentials: "same-origin", headers: { "X-Requested-With": "bed4book" } })).status, hotelId), 200, "non-empty hotel survives");

  assert.deepEqual(errors, [], "no browser errors");
  console.log("ok - T15 hotel, room, rate plan, calendar and delete E2E");
} catch (e) {
  await page.screenshot({ path: "e2e-t15-hotel-inventory.png", fullPage: true }).catch(() => {});
  console.log("not ok - T15 hotel inventory E2E");
  throw e;
} finally {
  await browser.close();
}
