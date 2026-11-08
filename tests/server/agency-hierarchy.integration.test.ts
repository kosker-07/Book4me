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
async function request(method: string, path: string, token: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { authorization: "Bearer " + token, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
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
  const hotel = randomUUID(), room = randomUUID(), rp = randomUUID();
  await pool.query("INSERT INTO hotels(id,owner_agency_id,name,location,status) VALUES ($1,$2,'Hierarchy Hotel','Antalya','active')",[hotel,ma]);
  await pool.query("INSERT INTO rooms(id,hotel_id,name) VALUES ($1,$2,'Room')",[room,hotel]);
  await pool.query("INSERT INTO rate_plans(id,room_id,board_name,currency,cancellation_policy,payment_terms) VALUES ($1,$2,'BB','EUR',$3::jsonb,$4::jsonb)",[rp,room,JSON.stringify({freeUntilDays:7,penaltyType:"nights",penaltyValue:1,noShowPenaltyType:"percent",noShowPenaltyValue:100}),JSON.stringify({dueDaysBeforeCheckIn:14})]);
  for (const agencyId of [sb,orphan]) {
    const response = await request("POST","/api/admin/publications",admin,{ratePlanId:rp,agencyId,markupType:"percent",markupValue:10});
    assert.equal(response.status,409,JSON.stringify(response.body));
    assert.equal(response.body.error,"TARGET_NOT_IN_HIERARCHY");
  }
  assert.equal((await request("POST","/api/admin/publications",a,{ratePlanId:rp,agencyId:sb,markupType:"percent",markupValue:10})).status,409);
  assert.equal((await request("GET","/api/admin/agencies/"+sa,a)).status,200);
  assert.equal((await request("GET","/api/admin/agencies/"+sb,b)).status,200);
});
