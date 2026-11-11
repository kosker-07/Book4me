// Marketplace stage 1 — bulk distribution rules, against real PostgreSQL and the real API.
// Three DMCs (A sells; B and C buy), one sub-agency each. A owns two hotels with one bookable rate plan each
// and a third rate plan without cancellation/payment terms (never sellable by rule).
import { VALID_TERMS } from "./fixtures/rate-plan-terms";
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const skip = !process.env.DATABASE_URL ? "DATABASE_URL required" : false;
if (skip && process.env.CI) throw new Error("DATABASE_URL required in CI");
process.env.SESSION_SECRET ||= "distribution-integration-secret-32-chars";
let pool: any, server: Server, base: string, hashPassword: (s: string) => string, issueSession: any;
const PW = "integration-password-1";

async function request(method: string, path: string, token: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(base + path, { method, headers: { authorization: "Bearer " + token, "content-type": "application/json", ...headers },
                                      body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) as any : null };
}

before(async () => {
  if (skip) return;
  ({ pool } = await import("../../server/db"));
  ({ hashPassword, issueSession } = await import("../../server/security"));
  const { default: app } = await import("../../server/app");
  server = app.listen(0);
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});
after(async () => { if (!skip) { server.close(); await pool.end(); } });
beforeEach(async () => {
  if (skip) return;
  await pool.query(`TRUNCATE agencies, users, hotels, rooms, rate_plans, inventory_daily, agency_hotel_sales, bookings,
    booking_status_history, booking_nights, audit_logs, idempotency_keys, fx_rates, login_attempts, vouchers, market_groups, fx_rate_history, proforma_counters CASCADE`);
});

const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const checkIn = day(40), mid = day(41), checkOut = day(42);

interface World {
  dmc: { a: string; b: string; c: string }; sub: { a: string; b: string; c: string };
  hotel: { h1: string; h2: string }; plan: { p1: string; p2: string; noTerms: string };
  t: { admin: string; office: string; masterA: string; masterB: string; subA: string; subB: string; subC: string };
}

async function seed(): Promise<World> {
  const id = () => randomUUID();
  const w: World = { dmc: { a: id(), b: id(), c: id() }, sub: { a: id(), b: id(), c: id() }, hotel: { h1: id(), h2: id() },
                     plan: { p1: id(), p2: id(), noTerms: id() }, t: {} as World["t"] };
  for (const [agencyId, name, type, parent] of [
    [w.dmc.a, "Seller DMC Alpha", "master", null], [w.dmc.b, "Buyer DMC Bravo", "master", null], [w.dmc.c, "Buyer DMC Charlie", "master", null],
    [w.sub.a, "Alpha Sub", "sub", w.dmc.a], [w.sub.b, "Bravo Sub", "sub", w.dmc.b], [w.sub.c, "Charlie Sub", "sub", w.dmc.c]
  ]) await pool.query("INSERT INTO agencies(id,name,type,parent_agency_id) VALUES ($1,$2,$3,$4)", [agencyId, name, type, parent]);

  const users: [keyof World["t"], string, string | null][] = [
    ["admin", "system_admin", null], ["office", "back_office", null], ["masterA", "master_agency", w.dmc.a], ["masterB", "master_agency", w.dmc.b],
    ["subA", "sub_agency", w.sub.a], ["subB", "sub_agency", w.sub.b], ["subC", "sub_agency", w.sub.c]
  ];
  for (const [key, role, agencyId] of users) {
    const userId = id();
    await pool.query("INSERT INTO users(id,email,password_hash,role,agency_id) VALUES ($1,$2,$3,$4,$5)",
      [userId, `dist-${key}@test.local`, hashPassword(PW), role, agencyId]);
    w.t[key] = issueSession({ sub: userId, role, agencyId, ver: 0 }, process.env.SESSION_SECRET!);
  }

  const terms = [JSON.stringify(VALID_TERMS.cancellationPolicy), JSON.stringify(VALID_TERMS.paymentTerms)];
  for (const [hotelId, name, planId] of [[w.hotel.h1, "Rule Hotel One", w.plan.p1], [w.hotel.h2, "Rule Hotel Two", w.plan.p2]] as const) {
    const room = id();
    await pool.query("INSERT INTO hotels(id,owner_agency_id,name,location,status) VALUES ($1,$2,$3,'Antalya','active')", [hotelId, w.dmc.a, name]);
    await pool.query("INSERT INTO rooms(id,hotel_id,name) VALUES ($1,$2,'Double')", [room, hotelId]);
    await pool.query("INSERT INTO rate_plans(id,room_id,board_name,currency,cancellation_policy,payment_terms) VALUES ($1,$2,'BB','EUR',$3::jsonb,$4::jsonb)",
      [planId, room, ...terms]);
    await pool.query("INSERT INTO inventory_daily(rate_plan_id,stay_date,price,allotment) VALUES ($1,$2,100,5),($1,$3,100,5)", [planId, checkIn, mid]);
    if (hotelId === w.hotel.h2) {
      await pool.query("INSERT INTO rate_plans(id,room_id,board_name,currency) VALUES ($1,$2,'HB','EUR')", [w.plan.noTerms, room]);
      await pool.query("INSERT INTO inventory_daily(rate_plan_id,stay_date,price,allotment) VALUES ($1,$2,50,5),($1,$3,50,5)", [w.plan.noTerms, checkIn, mid]);
    }
  }
  return w;
}

const search = (token: string) => request("POST", "/api/agency/searches", token, {
  checkIn, checkOut, rooms: 1, adults: 2, children: 0, childAges: [],
  roomOccupancies: [{ adults: 2, children: 0, childAges: [] }], nationalities: ["TR"]
});
const hotelsSeen = async (token: string) => {
  const r = await search(token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return new Set<string>(r.body.results.map((x: any) => x.hotel.id));
};
const book = (token: string, quoteId: string, extra: object = {}) => request("POST", "/api/agency/bookings", token, {
  quoteId, ...extra,
  guest: { firstName: "Test", lastName: "Guest", adults: 2, children: 0, childAges: [], email: "guest@test.local", phone: "+905551112233", nationality: "TR" },
  otherGuests: [{ firstName: "Second", lastName: "Guest", type: "adult", nationality: "TR" }], operationNote: "Arrival after 18:00"
}, { "Idempotency-Key": randomUUID() });
const rule = (token: string, body: object) => request("POST", "/api/admin/distribution-rules", token, body);

test("D1 no rule: another DMC's hotels are invisible; allow-all opens them to every other DMC, never to the seller's own subs", { skip }, async () => {
  const w = await seed();
  assert.equal((await hotelsSeen(w.t.subB)).size, 0);
  const created = await rule(w.t.admin, { sellerAgencyId: w.dmc.a, effect: "allow", note: " open to all " });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.buyer_agency_id, null);
  assert.equal(created.body.hotel_id, null);
  assert.equal(created.body.note, "open to all");
  assert.deepEqual([...(await hotelsSeen(w.t.subB))].sort(), [w.hotel.h1, w.hotel.h2].sort());
  assert.deepEqual([...(await hotelsSeen(w.t.subC))].sort(), [w.hotel.h1, w.hotel.h2].sort());
  assert.equal((await hotelsSeen(w.t.subA)).size, 0, "a rule never opens a DMC's inventory to its own sub-agencies");

  // The plan without cancellation/payment terms is never offered, and rule-based sales carry no markup.
  const results = (await search(w.t.subB)).body.results;
  assert.ok(results.every((x: any) => x.board === "BB"), "rate plan without terms must not be sold by rule");
  assert.ok(results.every((x: any) => x.total === "200.00"), JSON.stringify(results.map((x: any) => x.total)));

  const list = await request("GET", "/api/agency/hotels", w.t.subB);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.items.map((x: any) => x.id).sort(), [w.hotel.h1, w.hotel.h2].sort());
});

test("D2 buyer-specific and hotel-specific allow rules open exactly their scope", { skip }, async () => {
  const w = await seed();
  assert.equal((await rule(w.t.office, { sellerAgencyId: w.dmc.a, buyerAgencyId: w.dmc.b, hotelId: w.hotel.h1, effect: "allow" })).status, 201);
  assert.deepEqual([...(await hotelsSeen(w.t.subB))], [w.hotel.h1]);
  assert.equal((await hotelsSeen(w.t.subC)).size, 0, "a third DMC is not covered by a buyer-specific rule");
});

test("D3 deny beats allow; deactivating or deleting a rule takes effect immediately", { skip }, async () => {
  const w = await seed();
  assert.equal((await rule(w.t.admin, { sellerAgencyId: w.dmc.a, effect: "allow" })).status, 201);
  const deny = await rule(w.t.admin, { sellerAgencyId: w.dmc.a, buyerAgencyId: w.dmc.c, hotelId: w.hotel.h2, effect: "deny" });
  assert.equal(deny.status, 201, JSON.stringify(deny.body));
  assert.deepEqual([...(await hotelsSeen(w.t.subC))], [w.hotel.h1], "specific deny closes hotel two for DMC C only");
  assert.equal((await hotelsSeen(w.t.subB)).size, 2);

  const off = await request("PATCH", "/api/admin/distribution-rules/" + deny.body.id, w.t.admin, { active: false });
  assert.equal(off.status, 200);
  assert.equal(off.body.active, false);
  assert.equal((await hotelsSeen(w.t.subC)).size, 2, "an inactive deny rule no longer closes anything");

  const flipped = await request("PATCH", "/api/admin/distribution-rules/" + deny.body.id, w.t.admin, { active: true, effect: "allow" });
  assert.equal(flipped.body.effect, "allow");
  const denyAll = await rule(w.t.admin, { sellerAgencyId: w.dmc.a, buyerAgencyId: w.dmc.c, effect: "deny" });
  assert.equal(denyAll.status, 201);
  assert.equal((await hotelsSeen(w.t.subC)).size, 0, "a general deny beats a more specific allow");

  assert.equal((await request("DELETE", "/api/admin/distribution-rules/" + denyAll.body.id, w.t.admin)).status, 204);
  assert.equal((await hotelsSeen(w.t.subC)).size, 2);
  assert.equal((await request("DELETE", "/api/admin/distribution-rules/" + denyAll.body.id, w.t.admin)).status, 404);
});

test("D4 a publication row decides on its own: inactive closes, active keeps its markup", { skip }, async () => {
  const w = await seed();
  assert.equal((await rule(w.t.admin, { sellerAgencyId: w.dmc.a, effect: "allow" })).status, 201);
  const pub = await request("POST", "/api/admin/publications", w.t.admin, { ratePlanId: w.plan.p1, agencyId: w.sub.b, markupType: "percent", markupValue: 10 });
  assert.equal(pub.status, 201, JSON.stringify(pub.body));
  const priced = (await search(w.t.subB)).body.results.find((x: any) => x.hotel.id === w.hotel.h1);
  assert.equal(priced.total, "220.00", "the publication's own markup applies, not the rule's zero markup");
  assert.equal((await search(w.t.subB)).body.results.filter((x: any) => x.hotel.id === w.hotel.h1).length, 1, "no duplicate offer");

  assert.equal((await request("PATCH", "/api/admin/publications/" + pub.body.id, w.t.admin, { active: false })).status, 200);
  assert.deepEqual([...(await hotelsSeen(w.t.subB))], [w.hotel.h2], "an inactive publication closes the plan even though a rule allows it");
  assert.equal((await hotelsSeen(w.t.subC)).size, 2, "other sub-agencies are unaffected");
});

test("D5 booking through a rule: created, seller identity hidden, draft refused once the rule is switched off", { skip }, async () => {
  const w = await seed();
  await pool.query("UPDATE hotel_contracts SET name = 'Alpha Private Contract', seller_legal_name = 'Alpha Legal Ltd'");
  const allow = await rule(w.t.admin, { sellerAgencyId: w.dmc.a, buyerAgencyId: w.dmc.b, effect: "allow" });
  assert.equal(allow.status, 201);

  const found = await search(w.t.subB);
  const secrets = [w.dmc.a, "Seller DMC Alpha", "Alpha Private Contract", "Alpha Legal Ltd"];
  for (const secret of secrets) assert.ok(!JSON.stringify(found.body).includes(secret), "search leaks seller: " + secret);
  const quote = found.body.results.find((x: any) => x.hotel.id === w.hotel.h1);
  assert.ok(quote?.quoteId);

  const booked = await book(w.t.subB, quote.quoteId);
  assert.equal(booked.status, 201, JSON.stringify(booked.body));
  const detail = await request("GET", "/api/agency/bookings/" + booked.body.id, w.t.subB);
  assert.equal(detail.status, 200);
  for (const secret of secrets) assert.ok(!JSON.stringify(detail.body).includes(secret), "booking detail leaks seller: " + secret);
  for (const key of ["contract_code", "contract_name", "seller_legal_name"])
    assert.ok(!(key in detail.body.priceSnapshot), "marketplace buyer must not receive " + key);
  for (const key of ["hotel_owner_agency_id", "agency_parent_id", "agency_id"])
    assert.ok(!(key in detail.body), "internal column returned: " + key);

  // The buyer's DMC sees its sub-agency's booking without the seller's contract labels; the seller keeps its own.
  const buyerDmc = await request("GET", "/api/backoffice/bookings/" + booked.body.id, w.t.masterB);
  if (buyerDmc.status === 200) {
    for (const secret of secrets) assert.ok(!JSON.stringify(buyerDmc.body).includes(secret), "buyer DMC view leaks seller: " + secret);
  } else assert.equal(buyerDmc.status, 404);
  const sellerDmc = await request("GET", "/api/backoffice/bookings/" + booked.body.id, w.t.masterA);
  assert.equal(sellerDmc.status, 200);
  assert.equal(sellerDmc.body.priceSnapshot.contract_name, "Alpha Private Contract");
  assert.equal(sellerDmc.body.agency_name, "BED4BOOK");
  for (const key of ["hotel_owner_agency_id", "agency_parent_id"]) assert.ok(!(key in sellerDmc.body));

  // The proforma is the buyer's document: BED4BOOK is the seller and no contract label of the seller DMC is printed.
  await pool.query("UPDATE hotel_contracts SET code = 'ALPHA-SECRET-CODE'");
  const third = (await search(w.t.subB)).body.results.find((x: any) => x.hotel.id === w.hotel.h1);
  const forProforma = await book(w.t.subB, third.quoteId);
  assert.equal(forProforma.status, 201, JSON.stringify(forProforma.body));
  const proforma = await fetch(base + "/api/agency/bookings/" + forProforma.body.id + "/proforma", { headers: { authorization: "Bearer " + w.t.subB } });
  assert.equal(proforma.status, 201, "first request issues the proforma");
  const { spawnSync } = await import("node:child_process");
  const proformaText = spawnSync("pdftotext", ["-", "-"], { input: Buffer.from(await proforma.arrayBuffer()) }).stdout.toString("utf8");
  assert.ok(proformaText.includes("BED4BOOK"), "proforma names the platform as seller");
  for (const secret of [...secrets, "ALPHA-SECRET-CODE", "Kontrat / Contract"])
    assert.ok(!proformaText.includes(secret), "proforma leaks seller: " + secret);

  // A draft made while the rule was on cannot be submitted after the rule is switched off.
  const second = (await search(w.t.subB)).body.results.find((x: any) => x.hotel.id === w.hotel.h2);
  const draft = await book(w.t.subB, second.quoteId, { draft: true });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  assert.equal((await request("PATCH", "/api/admin/distribution-rules/" + allow.body.id, w.t.admin, { active: false })).status, 200);
  const submit = await request("POST", `/api/agency/bookings/${draft.body.id}/submit`, w.t.subB, {});
  assert.equal(submit.status, 404, JSON.stringify(submit.body));
  assert.equal(submit.body.error, "PRODUCT_NOT_PUBLISHED");
  const stale = await book(w.t.subB, quote.quoteId);
  assert.equal(stale.status, 404, "an old quote cannot be booked after the rule is switched off");
});

test("D6 only the platform operator manages rules; validation and audit", { skip }, async () => {
  const w = await seed();
  const created = await rule(w.t.admin, { sellerAgencyId: w.dmc.a, effect: "allow" });
  assert.equal(created.status, 201);
  for (const token of [w.t.masterA, w.t.masterB, w.t.subA, w.t.subB]) {
    assert.equal((await request("GET", "/api/admin/distribution-rules", token)).status, 403);
    assert.equal((await rule(token, { sellerAgencyId: w.dmc.a, effect: "deny" })).status, 403);
    assert.equal((await request("PATCH", "/api/admin/distribution-rules/" + created.body.id, token, { active: false })).status, 403);
    assert.equal((await request("DELETE", "/api/admin/distribution-rules/" + created.body.id, token)).status, 403);
  }
  const listed = await request("GET", "/api/admin/distribution-rules", w.t.office);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.items.length, 1);
  assert.equal(listed.body.items[0].seller_name, "Seller DMC Alpha");

  const bad: [object, number, string][] = [
    [{ sellerAgencyId: w.dmc.a, effect: "allow" }, 409, "DISTRIBUTION_RULE_EXISTS"],
    [{ sellerAgencyId: w.dmc.a, effect: "deny" }, 409, "DISTRIBUTION_RULE_EXISTS"],
    [{ sellerAgencyId: w.dmc.a, effect: "open" }, 400, "INVALID_DISTRIBUTION_RULE"],
    [{ effect: "allow" }, 400, "INVALID_DISTRIBUTION_RULE"],
    [{ sellerAgencyId: w.sub.a, effect: "allow" }, 400, "SELLER_MUST_BE_MASTER"],
    [{ sellerAgencyId: randomUUID(), effect: "allow" }, 400, "SELLER_MUST_BE_MASTER"],
    [{ sellerAgencyId: w.dmc.a, buyerAgencyId: w.sub.b, effect: "allow" }, 400, "BUYER_MUST_BE_MASTER"],
    [{ sellerAgencyId: w.dmc.a, buyerAgencyId: w.dmc.a, effect: "allow" }, 400, "BUYER_MUST_DIFFER_FROM_SELLER"],
    [{ sellerAgencyId: w.dmc.b, hotelId: w.hotel.h1, effect: "allow" }, 400, "HOTEL_NOT_OWNED_BY_SELLER"],
    [{ sellerAgencyId: w.dmc.a, buyerAgencyId: "not-a-uuid", effect: "allow" }, 400, "INVALID_DISTRIBUTION_RULE"],
    [{ sellerAgencyId: w.dmc.a, buyerAgencyId: w.dmc.b, effect: "allow", note: "x".repeat(501) }, 400, "INVALID_DISTRIBUTION_RULE"]
  ];
  for (const [body, status, error] of bad) {
    const r = await rule(w.t.admin, body);
    assert.equal(r.status, status, JSON.stringify(body) + " → " + JSON.stringify(r.body));
    assert.equal(r.body.error, error);
  }
  const path = "/api/admin/distribution-rules/" + created.body.id;
  assert.equal((await request("PATCH", path, w.t.admin, {})).status, 400);
  assert.equal((await request("PATCH", path, w.t.admin, { effect: "maybe" })).status, 400);
  assert.equal((await request("PATCH", path, w.t.admin, { buyerAgencyId: w.dmc.b })).status, 400);
  assert.equal((await request("PATCH", "/api/admin/distribution-rules/" + randomUUID(), w.t.admin, { active: false })).status, 404);

  assert.equal((await request("PATCH", path, w.t.office, { effect: "deny", note: "closed" })).status, 200);
  assert.equal((await request("DELETE", path, w.t.admin)).status, 204);
  const logs = (await pool.query(
    "SELECT action, before, after, target_agency_id FROM audit_logs WHERE entity_type = 'distribution_rule' AND entity_id = $1 ORDER BY id", [created.body.id])).rows;
  assert.deepEqual(logs.map((l: any) => l.action), ["distribution_rule.created", "distribution_rule.updated", "distribution_rule.deleted"]);
  assert.equal(logs[0].after.effect, "allow");
  assert.equal(logs[1].before.effect, "allow");
  assert.equal(logs[1].after.effect, "deny");
  assert.equal(logs[2].before.note, "closed");
  assert.ok(logs.every((l: any) => l.target_agency_id === w.dmc.a));
});

test("D7 an inactive buyer DMC or seller DMC gets nothing through a rule", { skip }, async () => {
  const w = await seed();
  assert.equal((await rule(w.t.admin, { sellerAgencyId: w.dmc.a, effect: "allow" })).status, 201);
  await pool.query("UPDATE agencies SET active = false WHERE id = $1", [w.dmc.c]);
  assert.equal((await hotelsSeen(w.t.subC)).size, 0, "sub-agency of an inactive DMC");
  assert.equal((await hotelsSeen(w.t.subB)).size, 2);
  await pool.query("UPDATE agencies SET active = false WHERE id = $1", [w.dmc.a]);
  assert.equal((await hotelsSeen(w.t.subB)).size, 0, "inactive seller DMC");
});
