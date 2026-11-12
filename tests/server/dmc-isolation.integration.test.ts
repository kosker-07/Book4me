import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

const skip=!process.env.DATABASE_URL?"DATABASE_URL required":false;
if(skip&&process.env.CI)throw Error("DATABASE_URL required in CI");
process.env.SESSION_SECRET||="dmc-isolation-tests-secret-at-least-32";
let pool:any,server:Server,base:string,tokenA:string,tokenB:string,subA:string,subB:string;
async function request(method:string,path:string,token:string,body?:unknown){
 const res=await fetch(base+path,{method,headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:res.status,body:await res.json() as any};
}
before(async()=>{
 if(skip)return;
 ({pool}=await import("../../server/db"));
 const {default:app}=await import("../../server/app");
 server=app.listen(0);base="http://127.0.0.1:"+(server.address() as AddressInfo).port;
});
after(async()=>{if(!skip){server.close();await pool.end()}});
beforeEach(async()=>{
 if(skip)return;
 const {hashPassword,issueSession}=await import("../../server/security");
 await pool.query("TRUNCATE agencies, users CASCADE");
 const a=randomUUID(),b=randomUUID();subA=randomUUID();subB=randomUUID();
 for(const [id,name,type,parent] of [[a,"DMC A","master",null],[b,"DMC B","master",null],[subA,"Private A","sub",a],[subB,"Secret B","sub",b]])
  await pool.query("INSERT INTO agencies(id,name,type,parent_agency_id) VALUES($1,$2,$3,$4)",[id,name,type,parent]);
 const ua=randomUUID(),ub=randomUUID();
 for(const [id,email,agency] of [[ua,"dmc-a@tests.local",a],[ub,"dmc-b@tests.local",b]])
  await pool.query("INSERT INTO users(id,email,password_hash,role,agency_id) VALUES($1,$2,$3,'master_agency',$4)",[id,email,hashPassword("password-123"),agency]);
 tokenA=issueSession({sub:ua,role:"master_agency",agencyId:a,ver:0},process.env.SESSION_SECRET!);
 tokenB=issueSession({sub:ub,role:"master_agency",agencyId:b,ver:0},process.env.SESSION_SECRET!);
});
test("D1 GET: foreign tenant and nonexistent UUID have identical status and response body",{skip},async()=>{
 const missing=randomUUID();
 const foreign=await request("GET","/api/dmc/subagencies/"+subB,tokenA);
 const absent=await request("GET","/api/dmc/subagencies/"+missing,tokenA);
 assert.equal(foreign.status,404);assert.deepEqual(foreign,absent);
 assert.deepEqual(foreign.body,{error:"NOT_FOUND"});
 const own=await request("GET","/api/dmc/subagencies/"+subA,tokenA);
 assert.equal(own.status,200);assert.equal(own.body.id,subA);
});
test("D1 PATCH: foreign tenant and nonexistent UUID have identical status and response body",{skip},async()=>{
 const missing=randomUUID();
 const foreign=await request("PATCH","/api/dmc/subagencies/"+subB,tokenA,{active:false});
 const absent=await request("PATCH","/api/dmc/subagencies/"+missing,tokenA,{active:false});
 assert.equal(foreign.status,404);assert.deepEqual(foreign,absent);
 assert.deepEqual(foreign.body,{error:"NOT_FOUND"});
 assert.equal((await pool.query("SELECT active FROM agencies WHERE id=$1",[subB])).rows[0].active,true);
});
test("D1 list and search do not expose another DMC by name, ID or total",{skip},async()=>{
 const list=await request("GET","/api/dmc/subagencies",tokenA);
 assert.equal(list.status,200);
 assert.equal(list.body.items.length,1);
 assert.equal(list.body.items[0].id,subA);
 assert.ok(!JSON.stringify(list.body).includes(subB));
 assert.ok(!JSON.stringify(list.body).includes("Secret B"));
 const search=await request("GET","/api/dmc/subagencies?search=Secret%20B",tokenA);
 assert.equal(search.status,200);
 assert.deepEqual(search.body.items,[]);
 assert.ok(!JSON.stringify(search.body).includes(subB));
});
test("D1 list remains tenant-specific for second DMC",{skip},async()=>{
 const result=await request("GET","/api/dmc/subagencies",tokenB);
 assert.equal(result.status,200);
 assert.deepEqual(result.body.items.map((x:any)=>x.id),[subB]);
});
