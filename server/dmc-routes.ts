import { Router } from "express";
import { randomUUID } from "node:crypto";
import { pool, withTransaction } from "./db";
import { authenticate, roles, httpError, audit, uuidParam } from "./http";
import { h, rowJson } from "./admin-routes";
import { validateRatePlanTerms } from "./validation";

export const dmcRouter = Router();
const access=[authenticate,roles("master_agency")] as const;

dmcRouter.get("/api/dmc/subagencies",...access,h(async(req,res)=>{
 const search=typeof req.query.search==="string"?req.query.search.trim():"";
 const result=await pool.query(
  "SELECT id,name,active,parent_agency_id,credit_limit_eur::text AS credit_limit_eur FROM agencies WHERE type='sub' AND parent_agency_id=$1 AND ($2::text = '' OR name ILIKE '%' || $2 || '%') ORDER BY name,id",
  [req.auth!.agencyId,search]);
 res.json({items:result.rows});
}));

dmcRouter.get("/api/dmc/subagencies/:id",...access,h(async(req,res)=>{
 const id=uuidParam(req);
 const result=await pool.query("SELECT id,name,active,parent_agency_id,credit_limit_eur::text AS credit_limit_eur FROM agencies WHERE id=$1 AND type='sub' AND parent_agency_id=$2",[id,req.auth!.agencyId]);
 if(!result.rows[0])throw httpError(404,"NOT_FOUND");
 res.json(result.rows[0]);
}));

dmcRouter.post("/api/dmc/subagencies",...access,h(async(req,res)=>{
 const body=req.body||{},name=body.name;
 if(typeof name!=="string"||!name.trim()||name.length>200||Object.keys(body).some(k=>k!=="name"))
  throw httpError(400,"INVALID_SUBAGENCY");
 const id=randomUUID(),clean=name.trim();
 await withTransaction(async client=>{
  await client.query("INSERT INTO agencies(id,name,type,parent_agency_id) VALUES($1,$2,'sub',$3)",[id,clean,req.auth!.agencyId]);
  await audit(client,req.auth!.sub,id,"agency.created","agency",id,{targetAgencyId:id,after:await rowJson(client,"agencies",id)});
 });
 res.status(201).json({id,name:clean,active:true});
}));

dmcRouter.patch("/api/dmc/subagencies/:id",...access,h(async(req,res)=>{
 const id=uuidParam(req),body=req.body||{};
 const keys=Object.keys(body);
 const hasActive=Object.prototype.hasOwnProperty.call(body,"active"),hasLimit=Object.prototype.hasOwnProperty.call(body,"creditLimitEur");
 if(!keys.length||keys.some(k=>k!=="active"&&k!=="creditLimitEur")||(hasActive&&typeof body.active!=="boolean"))
  throw httpError(400,"INVALID_SUBAGENCY");
 let limit:string|null|undefined;
 if(hasLimit){
  const v=body.creditLimitEur;
  if(v===null)limit=null;
  else if((typeof v==="number"||typeof v==="string")&&/^\d{1,12}(?:\.\d{1,2})?$/.test(String(v)))limit=String(v);
  else throw httpError(400,"INVALID_CREDIT_LIMIT");
 }
 const result=await withTransaction(async client=>{
  const before=(await client.query("SELECT * FROM agencies WHERE id=$1 AND type='sub' AND parent_agency_id=$2",[id,req.auth!.agencyId])).rows[0];
  if(!before)throw httpError(404,"NOT_FOUND");
  const updated=(await client.query(
   "UPDATE agencies SET active=CASE WHEN $3::boolean IS NULL THEN active ELSE $3 END, credit_limit_eur=CASE WHEN $4::boolean THEN $5::numeric ELSE credit_limit_eur END WHERE id=$1 AND parent_agency_id=$2 RETURNING id,name,active,credit_limit_eur::text AS credit_limit_eur",
   [id,req.auth!.agencyId,hasActive?body.active:null,hasLimit,limit??null])).rows[0];
  await audit(client,req.auth!.sub,id,"agency.updated","agency",id,{targetAgencyId:id,before,after:await rowJson(client,"agencies",id)});
  return updated;
 });
 res.json(result);
}));

// Bulk margin for one sub-agency: the DMC sets the percent markup on every publication of its own hotels for that
// sub-agency in one step (effective on the next search; existing bookings keep their frozen price). With publishAll
// the DMC also opens every sellable rate plan of its own active hotels to that sub-agency. Another DMC's sub → 404.
dmcRouter.put("/api/dmc/subagencies/:id/markup",...access,h(async(req,res)=>{
 const id=uuidParam(req),body=req.body||{};
 const v=body.markupPercent;
 if(Object.keys(body).some(k=>k!=="markupPercent"&&k!=="publishAll")||(body.publishAll!==undefined&&typeof body.publishAll!=="boolean")
   ||typeof v!=="number"||!Number.isFinite(v)||v<0||v>100||Math.abs(v*1000-Math.round(v*1000))>1e-6)
  throw httpError(400,"INVALID_MARKUP");
 const dmc=req.auth!.agencyId!;
 const sub=(await pool.query("SELECT id,active FROM agencies WHERE id=$1 AND type='sub' AND parent_agency_id=$2",[id,dmc])).rows[0];
 if(!sub)throw httpError(404,"NOT_FOUND");
 if(body.publishAll&&!sub.active)throw httpError(409,"SUBAGENCY_INACTIVE");
 const value=String(Math.round(v*1000)/1000);
 const out=await withTransaction(async client=>{
  const updated=(await client.query(
   `UPDATE agency_hotel_sales s SET markup_type='percent', markup_value=$3::numeric
      FROM hotels h WHERE s.hotel_id=h.id AND h.owner_agency_id=$2 AND s.agency_id=$1 RETURNING s.id`,[id,dmc,value])).rowCount??0;
  let published=0,skippedNoTerms=0;
  if(body.publishAll){
   const plans=(await client.query(
    `SELECT rp.id, r.hotel_id, rp.cancellation_policy, rp.payment_terms FROM rate_plans rp
       JOIN rooms r ON r.id=rp.room_id AND r.active JOIN hotels h ON h.id=r.hotel_id AND h.owner_agency_id=$2 AND h.status='active'
      WHERE rp.active AND NOT EXISTS (SELECT 1 FROM agency_hotel_sales s WHERE s.agency_id=$1 AND s.rate_plan_id=rp.id)`,[id,dmc])).rows;
   for(const p of plans){
    if(!validateRatePlanTerms(p.cancellation_policy,p.payment_terms)){skippedNoTerms++;continue}
    await client.query("INSERT INTO agency_hotel_sales(agency_id,hotel_id,rate_plan_id,markup_type,markup_value,active) VALUES ($1,$2,$3,'percent',$4::numeric,true)",[id,p.hotel_id,p.id,value]);
    published++;
   }
  }
  const result={markupPercent:Number(value),updated,published,skippedNoTerms};
  await audit(client,req.auth!.sub,dmc,"publication.bulk_markup","agency",id,{targetAgencyId:id,after:result});
  return result;
 });
 res.json(out);
}));
