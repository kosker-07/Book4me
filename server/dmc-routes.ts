import { Router } from "express";
import { randomUUID } from "node:crypto";
import { pool, withTransaction } from "./db";
import { authenticate, roles, httpError, audit, uuidParam } from "./http";
import { h, rowJson } from "./admin-routes";

export const dmcRouter = Router();
const access=[authenticate,roles("master_agency")] as const;

dmcRouter.get("/api/dmc/subagencies",...access,h(async(req,res)=>{
 const result=await pool.query(
  "SELECT id,name,active,parent_agency_id FROM agencies WHERE type='sub' AND parent_agency_id=$1 ORDER BY name,id",
  [req.auth!.agencyId]);
 res.json({items:result.rows});
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
 if(typeof body.active!=="boolean"||Object.keys(body).some(k=>k!=="active"))
  throw httpError(400,"INVALID_SUBAGENCY");
 const result=await withTransaction(async client=>{
  const before=(await client.query("SELECT * FROM agencies WHERE id=$1 AND type='sub' AND parent_agency_id=$2 FOR UPDATE",[id,req.auth!.agencyId])).rows[0];
  if(!before)throw httpError(404,"NOT_FOUND");
  const updated=(await client.query("UPDATE agencies SET active=$3 WHERE id=$1 AND parent_agency_id=$2 RETURNING id,name,active",[id,req.auth!.agencyId,body.active])).rows[0];
  await audit(client,req.auth!.sub,id,"agency.updated","agency",id,{targetAgencyId:id,before,after:await rowJson(client,"agencies",id)});
  return updated;
 });
 res.json(result);
}));
