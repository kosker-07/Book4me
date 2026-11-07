/* BED4BOOK module tests. Run with: node tests/bed4book.js */
const load = require("../tools/load.js");
const B = load();
const ok = (v,m) => { if(!v) throw new Error(m || "assertion failed"); };
const eq = (a,b,m) => { if(JSON.stringify(a)!==JSON.stringify(b)) throw new Error((m||"not equal")+": "+JSON.stringify(a)+" !== "+JSON.stringify(b)); };
(async () => {
  const now = Date.parse("2026-11-07T12:00:00Z");
  B.util._now = now;
  const X = B.bed4book;
  ok(X && X.rebooking && X.rateRelay, "module exports");
  const old = B.db.all("bookings").find(x => x.kind === "h" && x.status === "Onaylı");
  ok(old, "seed hotel booking");
  const oldSupplier = String(old.sup);
  const oldHotel = B.db.get("hotels", old.hid);
  const eqv = { propertyKey:String(old.hid), roomKey:String(old.room), boardKey:String(oldHotel.board||""), checkIn:old.a, checkOut:old.b, occupancyKey:JSON.stringify([...(old.guests||[])].sort()), marketKey:String(old.nat||""), cancellationKey:String(old.dl||""), paymentKey:String(old.paymentKey||"") };
  const baselineEur = B.price.cv(old.cost, old.costCur || old.cur, "EUR");
  const cheaperTotal = Math.max(0.01, baselineEur * 0.5);
  const mkOffer = (total) => ({available:true,total,currency:"EUR",equivalence:eqv});
  X.registerSupplier("test-new", {
    quote: async () => [mkOffer(cheaperTotal)],
    recheck: async o => o,
    book: async () => ({confirmed:true,confirmationNumber:"TEST-CONF-1"}),
    cancel: async () => ({confirmed:true})
  });
  X.registerSupplier(oldSupplier, {
    quote: async () => [],
    recheck: async o => o,
    book: async () => ({confirmed:true,confirmationNumber:"OLD"}),
    cancel: async () => ({confirmed:true})
  });
  const rr = await X.rebooking.create(old.id,{idempotencyKey:"test-rb-1"});
  ok(rr.ok, rr.msg);
  eq(rr.operation.state,"completed","rebooking completes through adapter contract");
  const duplicate = await X.rebooking.create(old.id,{idempotencyKey:"test-rb-1"});
  ok(!duplicate.ok && duplicate.operation.id === rr.operation.id,"idempotency key must prevent a duplicate rebooking");
  eq(String(old.sup),"test-new","supplier changes after both confirmations");
  X.registerSupplier("3", {
    quote: async () => [],
    recheck: async o => o,
    book: async () => ({confirmed:true,confirmationNumber:"SUP3"}),
    cancel: async () => ({confirmed:true})
  });
  B.auth.start(B.db.find("users", u => u.email === "admin@book4me-ai.com"));
  const poolResult = X.rateRelay.create(old.id,{equivalence:eqv});
  ok(poolResult.ok,poolResult.msg);
  const pool = poolResult.pool;
  B.auth.start(B.db.find("users", u => u.org === "s" && u.oid === 3));
  const relayTotal = Math.max(0.001, cheaperTotal * 0.5);
  const bid = X.rateRelay.submit(pool.id,"3",mkOffer(relayTotal));
  ok(bid.ok,bid.msg);
  ok(X.rateRelay.publicBids(pool.id).every(x => !("supplierId" in x)),"public bid projection must be anonymous");
  B.util._now = pool.closesAt + 1;
  B.auth.start(B.db.find("users", u => u.email === "admin@book4me-ai.com"));
  const closed = X.rateRelay.close(pool.id);
  ok(closed.ok,closed.msg);
  eq(closed.winner.totalEur,relayTotal,"lowest normalized bid wins");
  console.log("BED4BOOK tests passed");
})().catch(e => { console.error(e); process.exitCode = 1; });
