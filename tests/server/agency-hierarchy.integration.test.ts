import { VALID_TERMS } from "./fixtures/rate-plan-terms";
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const skip = !process.env.DATABASE_URL ? "DATABASE_URL required" : false;
if (skip && process.env.CI) throw new Error("DATABASE_URL required in CI");
process.env.SESSION_SECRET ||= "hierarchy-integration-secret-at-least-32";
let pool: any, server: Server, base: string, hashPassword: (s: string) => string;
const PW = "integration-password-1";
async function request(method: string, path: string, token: string, body?: unknown, headers: Record<string,string> = {}) {
  const r = await fetch(base + path, { method, headers: { authorization: "Bearer " + token, "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() as any };
}
before(async () => {
  if (skip) return;
  ({pool} = await import("../../server/db"));
  ({hashPassword} = await import("../../server/security"));
  const {default: app} = await import("../../server/app");
  server = app.listen(0);
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
});
after(async () => { if (!skip) { server.close(); await pool.end(); } });
beforeEach(async () => {
  if (skip) return;
  await pool.query(`TRUNCATE agencies, users, hotels, rooms, rate_plans, inventory_daily, agency_hotel_sales, bookings,
    booking_status_history, booking_nights, audit_logs, idempotency_keys, fx_rates, login_attempts, vouchers, market_groups, fx_rate_history, proforma_counters CASCADE`);
});
test("two-DMC agency/user isolation, parent enforcement, platform role denial and publication isolation", {skip}, async () => {
  const {issueSession} = await import("../../server/security");
  const ids = Array.from({length: 5}, () => randomUUID());
  const [ma, mb, sa, sb, orphan] = ids;
  for (const [id, name, type, parent] of [
    [ma,"DMC A","master",null],[mb,"DMC B","master",null],
    [sa,"Sub A","sub",ma],[sb,"Sub B","sub",mb],[orphan,"Legacy orphan","sub",null]
  ]) await pool.query("INSERT INTO agencies(id,name,type,parent_agency_id) VALUES ($1,$2,$3,$4)", [id,name,type,parent]);
  const uid = Array.from({length: 4}, () => randomUUID());
  const roles = ["system_admin","master_agency","master_agency","sub_agency"] as const;
  const agencies = [null,ma,mb,sb];
  for (let i=0;i<4;i++) await pool.query("INSERT INTO users(id,email,password_hash,role,agency_id) VALUES ($1,$2,$3,$4,$5)", [uid[i],"hierarchy-"+i+"@test.local",hashPassword(PW),roles[i],agencies[i]]);
  const tokens = uid.map((id,i) => issueSession({sub:id,role:roles[i]!,agencyId:agencies[i],ver:0},process.env.SESSION_SECRET!));
  const [admin,a,b,sub] = tokens;
  const agList = await request("GET","/api/admin/agencies",a);
  assert.equal(agList.status,200);
  assert.ok(agList.body.items.some((x:any)=>x.id===sa));
  assert.ok(!agList.body.items.some((x:any)=>x.id===sb));
  const users = await request("GET","/api/admin/users",a);
  assert.equal(users.status,200);
  assert.ok(!users.body.items.some((x:any)=>x.id===uid[2]));
  assert.ok(!users.body.items.some((x:any)=>x.id===uid[3]));
  for (const path of ["/api/admin/agencies/"+sb,"/api/admin/users/"+uid[3]]) {
    assert.equal((await request("GET",path,a)).status,404);
    assert.equal((await request("PATCH",path,a,{active:false})).status,404);
  }
  assert.equal((await request("POST","/api/admin/users",a,{email:"intruder@test.local",password:PW,role:"sub_agency",agencyId:sb})).status,404);
  for (const role of ["system_admin","back_office"])
    assert.equal((await request("POST","/api/admin/users",a,{email:role+"@test.local",password:PW,role,agencyId:null})).status,403);
  const created = await request("POST","/api/admin/agencies",a,{name:"Sub A2",type:"sub",parentAgencyId:mb});
  assert.equal(created.status,201);
  assert.equal(created.body.parentAgencyId,ma);
  assert.equal((await pool.query("SELECT parent_agency_id FROM agencies WHERE id=$1",[created.body.id])).rows[0].parent_agency_id,ma);
  assert.equal((await request("POST","/api/admin/agencies",admin,{name:"No parent",type:"sub"})).status,400);
  for (const path of ["/api/admin/agencies","/api/admin/users"]) {
    assert.equal((await request("GET",path,sub)).status,403);
    assert.equal((await request("POST",path,sub,{})).status,403);
  }
  // Marketplace self-service: a master can change only its own markup.
  const ownMarkup = await request("PATCH", "/api/admin/agencies/"+ma, a, {marketplaceMarkupPercent:"12.5"});
  assert.equal(ownMarkup.status, 200, JSON.stringify(ownMarkup.body));
  assert.equal((await pool.query("SELECT marketplace_markup_percent::text AS value FROM agencies WHERE id=$1",[ma])).rows[0].value,"12.500");
  assert.equal((await request("PATCH","/api/admin/agencies/"+mb,a,{marketplaceMarkupPercent:10})).status,404);
  assert.equal((await request("PATCH","/api/admin/agencies/"+ma,a,{marketplaceMarkupPercent:10,active:false})).status,403);
  assert.equal((await request("PATCH","/api/admin/agencies/"+ma,a,{active:false})).status,403);
  // Platform fee is operator-only and does not permit master self-service.
  assert.equal((await request("PATCH","/api/admin/agencies/"+ma,a,{platformFeePercent:5})).status,403);
  assert.equal((await request("PATCH","/api/admin/agencies/"+mb,a,{platformFeePercent:5})).status,404);
  assert.equal((await request("PATCH","/api/admin/agencies/"+ma,admin,{platformFeePercent:"2.5"})).status,200);
  assert.equal((await pool.query("SELECT platform_fee_percent::text AS value FROM agencies WHERE id=$1",[ma])).rows[0].value,"2.500");
  const hotel = randomUUID(), room = randomUUID(), rp = randomUUID();
  await pool.query("INSERT INTO hotels(id,owner_agency_id,name,location,status) VALUES ($1,$2,'Hierarchy Hotel','Antalya','active')",[hotel,ma]);
  await pool.query("INSERT INTO rooms(id,hotel_id,name) VALUES ($1,$2,'Room')",[room,hotel]);
  await pool.query("INSERT INTO rate_plans(id,room_id,board_name,currency,cancellation_policy,payment_terms) VALUES ($1,$2,'BB','EUR',$3::jsonb,$4::jsonb)",[rp,room,JSON.stringify(VALID_TERMS.cancellationPolicy),JSON.stringify(VALID_TERMS.paymentTerms)]);
  // Room overview is tenant-scoped and includes each room's rate-plan count.
  const ownRooms = await request("GET", "/api/backoffice/hotels/"+hotel+"/rooms", a);
  assert.equal(ownRooms.status, 200, JSON.stringify(ownRooms.body));
  assert.equal(ownRooms.body.hotel.id, hotel);
  assert.equal(ownRooms.body.items.length, 1);
  assert.equal(ownRooms.body.items[0].id, room);
  assert.equal(ownRooms.body.items[0].rate_plan_count, 1);
  assert.equal((await request("GET","/api/backoffice/hotels/"+hotel+"/rooms",b)).status,404);
  assert.equal((await request("GET","/api/backoffice/hotels/"+hotel+"/rooms",sub)).status,403);
  assert.equal((await request("GET","/api/backoffice/hotels/"+hotel+"/rooms",admin)).status,200);
  assert.equal((await request("GET","/api/backoffice/hotels/"+randomUUID()+"/rooms",a)).status,404);
  assert.equal((await request("GET","/api/backoffice/hotels/not-a-uuid/rooms",a)).status,400);
  for (const agencyId of [orphan]) {
    const response = await request("POST","/api/admin/publications",admin,{ratePlanId:rp,agencyId,markupType:"percent",markupValue:10});
    assert.equal(response.status,409,JSON.stringify(response.body));
    assert.equal(response.body.error,"TARGET_NOT_IN_HIERARCHY");
  }
  assert.equal((await request("POST","/api/admin/publications",a,{ratePlanId:rp,agencyId:sb,markupType:"percent",markupValue:10})).status,409);
  // Platform may publish across DMCs; master agencies may not.
  const valid = await request("POST","/api/admin/publications",admin,{ratePlanId:rp,agencyId:sb,markupType:"percent",markupValue:10});
  assert.equal(valid.status,201,JSON.stringify(valid.body));
  const checkIn = new Date(Date.now()+40*86400000).toISOString().slice(0,10);
  const checkOut = new Date(Date.now()+42*86400000).toISOString().slice(0,10);
  const next = new Date(Date.now()+41*86400000).toISOString().slice(0,10);
  await pool.query("INSERT INTO inventory_daily(rate_plan_id,stay_date,price,allotment) VALUES ($1,$2,100,5),($1,$3,100,5)",[rp,checkIn,next]);
  const search = await request("POST","/api/agency/searches",sub,{
    checkIn,checkOut,rooms:1,adults:2,children:0,childAges:[],
    roomOccupancies:[{adults:2,children:0,childAges:[]}],nationalities:["TR"]
  });
  assert.equal(search.status,200,JSON.stringify(search.body));
  assert.equal(search.body.results.some((x:any)=>x.hotel.id===hotel),true,"platform publication visible across DMCs");
  assert.ok(!JSON.stringify(search.body).includes(ma));
  assert.ok(!JSON.stringify(search.body).includes("DMC A"));
  const quote = search.body.results.find((x:any)=>x.hotel.id===hotel);
  assert.ok(quote?.quoteId);
  const booked = await request("POST","/api/agency/bookings",sub,{
    quoteId:quote.quoteId,
    guest:{firstName:"Test",lastName:"Guest",adults:2,children:0,childAges:[],email:"guest@test.local",phone:"+905551112233",nationality:"TR"},
    otherGuests:[{firstName:"Second",lastName:"Guest",type:"adult",nationality:"TR"}],operationNote:"Arrival after 18:00"
  },{"Idempotency-Key":randomUUID()});
  assert.equal(booked.status,201,JSON.stringify(booked.body));
  const bookingId = booked.body.id;
  const sellerList = await request("GET","/api/backoffice/bookings",a);
  assert.equal(sellerList.status,200);
  const sellerItem = sellerList.body.items.find((x:any)=>x.id===bookingId);
  assert.equal(sellerItem.agency_name,"BED4BOOK");
  const sellerDetail = await request("GET","/api/backoffice/bookings/"+bookingId,a);
  assert.equal(sellerDetail.status,200);
  assert.equal(sellerDetail.body.agency_name,"BED4BOOK");
  for (const payload of [sellerItem,sellerDetail.body]) {
    const json = JSON.stringify(payload);
    for (const secret of [mb,sb,"DMC B","Sub B"]) assert.ok(!json.includes(secret),"seller response leaks buyer: "+secret);
    assert.ok(!("agency_id" in payload));
  }
  const buyerDetail = await request("GET","/api/agency/bookings/"+bookingId,sub);
  assert.equal(buyerDetail.status,200);
  for (const secret of [ma,"DMC A"]) assert.ok(!JSON.stringify(buyerDetail.body).includes(secret));
  const approved = await request("PATCH","/api/backoffice/bookings/"+bookingId+"/status",a,{status:"approved"});
  assert.equal(approved.status,200,JSON.stringify(approved.body));
  const voucherResponse = await fetch(base+"/api/agency/bookings/"+bookingId+"/voucher",{headers:{authorization:"Bearer "+sub}});
  assert.equal(voucherResponse.status,200);
  const voucherBytes = Buffer.from(await voucherResponse.arrayBuffer());
  assert.equal(voucherResponse.headers.get("content-type"),"application/pdf");
  const {spawnSync} = await import("node:child_process");
  const pdfText = spawnSync("pdftotext",["-","-"],{input:voucherBytes}).stdout.toString("utf8");
  for (const secret of [ma,"DMC A"]) assert.ok(!pdfText.includes(secret),"voucher leaks seller");
  const ownPublication = await request("POST","/api/admin/publications",a,{ratePlanId:rp,agencyId:sa,markupType:"percent",markupValue:10});
  assert.equal(ownPublication.status,201,JSON.stringify(ownPublication.body));
  const ownUserId = randomUUID();
  await pool.query("INSERT INTO users(id,email,password_hash,role,agency_id) VALUES ($1,'hierarchy-own@test.local',$2,'sub_agency',$3)",[ownUserId,hashPassword(PW),sa]);
  const ownToken = issueSession({sub:ownUserId,role:"sub_agency",agencyId:sa,ver:0},process.env.SESSION_SECRET!);
  const ownSearch = await request("POST","/api/agency/searches",ownToken,{
    checkIn,checkOut,rooms:1,adults:2,children:0,childAges:[],
    roomOccupancies:[{adults:2,children:0,childAges:[]}],nationalities:["TR"]
  });
  assert.equal(ownSearch.status,200);
  const ownQuote = ownSearch.body.results.find((x:any)=>x.hotel.id===hotel);
  assert.ok(ownQuote?.quoteId);
  const ownBooking = await request("POST","/api/agency/bookings",ownToken,{
    quoteId:ownQuote.quoteId,
    guest:{firstName:"Test",lastName:"Guest",adults:2,children:0,childAges:[],email:"guest@test.local",phone:"+905551112233",nationality:"TR"},
    otherGuests:[{firstName:"Second",lastName:"Guest",type:"adult",nationality:"TR"}],operationNote:"Arrival after 18:00"
  },{"Idempotency-Key":randomUUID()});
  assert.equal(ownBooking.status,201,JSON.stringify(ownBooking.body));
  const ownSellerDetail = await request("GET","/api/backoffice/bookings/"+ownBooking.body.id,a);
  assert.equal(ownSellerDetail.status,200);
  assert.equal(ownSellerDetail.body.agency_name,"Sub A");
  assert.equal((await request("GET","/api/admin/agencies/"+sa,a)).status,200);
  assert.equal((await request("GET","/api/admin/agencies/"+sb,b)).status,200);
});
