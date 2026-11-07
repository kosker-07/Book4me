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
  const eqv = { propertyKey:String(old.hid), roomKey:String(old.room), boardKey:"", checkIn:old.a, checkOut:old.b, occupancyKey:JSON.stringify([...(old.guests||[])].sort()), marketKey:String(old.nat||""), cancellationKey:String(old.dl||""), paymentKey:String(old.paymentKey||"") };
  const mkOffer = (total) => ({available:true,total,currency:"EUR",equivalence:eqv});
  X.registerSupplier("test-new", {
    quote: async () => [mkOffer(1)],
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
  eq(String(old.sup),"test-new","supplier changes after both confirmations");
  const poolResult = X.rateRelay.create(old.id,{equivalence:eqv});
  ok(poolResult.ok,poolResult.msg);
  const pool = poolResult.pool;
  const bid = X.rateRelay.submit(pool.id,"supplier-A",mkOffer(0.5));
  ok(bid.ok,bid.msg);
  ok(X.rateRelay.publicBids(pool.id).every(x => !("supplierId" in x)),"public bid projection must be anonymous");
  B.util._now = pool.closesAt + 1;
  const closed = X.rateRelay.close(pool.id);
  ok(closed.ok,closed.msg);
  eq(closed.winner.totalEur,0.5,"lowest normalized bid wins");
  console.log("BED4BOOK tests passed");
})().catch(e => { console.error(e); process.exitCode = 1; });
