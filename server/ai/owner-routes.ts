import {Router} from "express";
import {pool} from "../db";
import {authenticate,type AuthedRequest} from "../http";
import {runPlatformAgent} from "./agents/runner";
export const ownerAssistantRouter=Router();
ownerAssistantRouter.post("/api/ai/assistant/ask",authenticate,async(req:AuthedRequest,res,next)=>{
  try{
    if(req.auth?.role==="master_agency"||req.auth?.role==="sub_agency")
      return res.status(404).json({error:"NOT_FOUND"});
    if(req.auth?.role!=="system_admin")
      return res.status(403).json({error:"FORBIDDEN"});
    const question=req.body?.question;
    if(typeof question!=="string"||!question.trim()||question.length>4000)
      return res.status(400).json({error:"INVALID_QUESTION"});
    const result=await runPlatformAgent(pool,"owner-assistant",{trigger:"owner_question",prompt:question.trim()});
    res.json({runId:result.runId,status:result.status,answer:result.text});
  }catch(e){next(e)}
});
