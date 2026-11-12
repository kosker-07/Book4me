import { Router } from "express";
import { randomUUID } from "node:crypto";
import { pool, withTransaction } from "./db";
import { authenticate, roles, httpError, audit, uuidParam } from "./http";
import { h, rowJson } from "./admin-routes";

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
