import test,{before,after,beforeEach} from "node:test";
import assert from "node:assert/strict";
import type {Server} from "node:http";
import type {AddressInfo} from "node:net";
import {randomUUID} from "node:crypto";
import {IDLE_TTL_SECONDS,hashPassword,verifySession} from "../../server/security";

const url=process.env.DATABASE_URL;
if(!url&&process.env.CI)throw new Error("DATABASE_URL required for session tests");
const skip=url?false:"DATABASE_URL not set";
process.env.SESSION_SECRET ||= "session-idle-integration-secret-32-characters";
const password="session-test-password-123";
let pool:typeof import("../../server/db").pool,server:Server,base="";
let userId="";
const realNow=Date.now;
const cookie=(r:Response)=>r.headers.get("set-cookie")?.split(";")[0]??"";
const request=(method:string,path:string,c?:string,body?:unknown)=>fetch(base+path,{
  method,headers:{"content-type":"application/json",...(c?{cookie:c}:{}),...(method!=="GET"?{"x-requested-with":"bed4book"}:{})},
  body:body===undefined?undefined:JSON.stringify(body)
});
async function login(){
  const r=await request("POST","/api/auth/login",undefined,{email:"idle@example.test",password});
  assert.equal(r.status,200,await r.text());const c=cookie(r);
  assert.ok(c.startsWith("b4b_session="));return c;
}
before(async()=>{if(skip)return;({pool}=await import("../../server/db"));const {default:app}=await import("../../server/app");server=app.listen(0);base="http://127.0.0.1:"+(server.address() as AddressInfo).port});
after(async()=>{Date.now=realNow;if(skip)return;await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await pool.end()});
beforeEach(async()=>{Date.now=realNow;if(skip)return;await pool.query("TRUNCATE users,agencies,login_attempts,audit_logs CASCADE");userId=randomUUID();await pool.query("INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,$3,'system_admin')",[userId,"idle@example.test",hashPassword(password)])});
test("SI1 login and GET /api/me return 200; cookie is renewed after five minutes",{skip},async()=>{
  const start=realNow();Date.now=()=>start;
  try{const c=await login();Date.now=()=>start+301000;const r=await request("GET","/api/me",c);assert.equal(r.status,200);assert.ok(cookie(r).startsWith("b4b_session="),"renewed Set-Cookie required")}finally{Date.now=realNow}
});
test("SI2 browser reload with same cookie preserves session",{skip},async()=>{const c=await login();assert.equal((await request("GET","/api/me",c)).status,200);assert.equal((await request("GET","/api/me",c)).status,200)});
test("SI3 activity renews idle expiry without sleeping",{skip},async()=>{
  const start=realNow();Date.now=()=>start;
  try{let c=await login();Date.now=()=>start+30*60000;const r=await request("GET","/api/me",c);assert.equal(r.status,200);c=cookie(r);assert.ok(c);Date.now=()=>start+75*60000;assert.equal((await request("GET","/api/me",c)).status,200)}finally{Date.now=realNow}
});
test("SI4 idle beyond 60 minutes returns 401",{skip},async()=>{
  const start=realNow();Date.now=()=>start;
  try{const c=await login();Date.now=()=>start+(IDLE_TTL_SECONDS+1)*1000;assert.equal((await request("GET","/api/me",c)).status,401)}finally{Date.now=realNow}
});
test("SI5 logout revokes old cookie through token_version",{skip},async()=>{
  const c=await login();assert.equal((await request("POST","/api/auth/logout",c)).status,200);assert.equal((await request("GET","/api/me",c)).status,401);
});
test("SI6 password change and user deactivation revoke old cookie",{skip},async()=>{
  let c=await login();const changed=await request("POST","/api/auth/change-password",c,{currentPassword:password,newPassword:"new-session-password-123"});assert.equal(changed.status,200,await changed.text());assert.equal((await request("GET","/api/me",c)).status,401);
  await pool.query("UPDATE users SET password_hash=$1 WHERE id=$2",[hashPassword(password),userId]);c=await login();await pool.query("UPDATE users SET active=false WHERE id=$1",[userId]);assert.equal((await request("GET","/api/me",c)).status,401);
});
