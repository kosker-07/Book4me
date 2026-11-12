// Operator AI Center. No platform credentials or DMC data are exposed to the browser.
export async function aiCenter({view,api,message,session,errText}) {
  const root=view();
  const node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);return e};
  const add=(parent,tag,text)=>{const e=node(tag,text);parent.append(e);return e};
  const button=(parent,text,fn)=>{const e=add(parent,'button',text);e.type='button';e.addEventListener('click',fn);return e};
  const canWrite=session.user?.role==='system_admin';
  const tabs=add(root,'div');tabs.className='tabs';
  const body=add(root,'div');
  const error=e=>message(errText(e));
  async function agents() {
    body.replaceChildren();
    const data=await api('/api/ai/agents');
    if(!data.configured){const warning=add(body,'p','AI not configured');warning.setAttribute('role','alert');}
    for(const a of data.items){
      const section=add(body,'section');section.className='card';
      add(section,'h3',a.name||a.id);
      add(section,'p','Today: '+a.tokens_today+' tokens · Last run: '+(a.last_run_status||'—'));
      const enabled=add(section,'input');enabled.type='checkbox';enabled.checked=a.enabled;enabled.disabled=!canWrite;
      const model=add(section,'input');model.value=a.model;model.disabled=!canWrite;model.setAttribute('aria-label','Model');
      const budget=add(section,'input');budget.type='number';budget.min='0';budget.max='5000000';budget.value=a.daily_token_budget;budget.disabled=!canWrite;budget.setAttribute('aria-label','Daily token budget');
      if(canWrite)button(section,'Save',async()=>{try{await api('/api/ai/agents/'+encodeURIComponent(a.id),{method:'PATCH',body:{enabled:enabled.checked,model:model.value,daily_token_budget:Number(budget.value)}});message('Saved');await agents();}catch(e){error(e)}});
    }
    // PR-F supplies the optional owner-only chat widget; keep PR-D independently deployable.
    if(canWrite){
      const available=await fetch('./owner-assistant.js',{method:'HEAD'}).then(r=>r.ok).catch(()=>false);
      if(available){const widget=await import('./owner-assistant.js');widget.ownerAssistantWidget({parent:body,api,message,errText});}
    }
  }
  async function approvals(){
    body.replaceChildren();
    const data=await api('/api/ai/approvals?state=pending');
    if(!data.items.length)add(body,'p','No pending approvals');
    for(const a of data.items){
      const section=add(body,'section');section.className='card';
      const heading=add(section,'h3',a.agent_id+' · '+a.risk.toUpperCase());heading.className=a.risk==='high'?'ai-risk-high':'ai-risk-medium';
      add(section,'p',a.summary);
      add(section,'p','Amount: '+(a.amount_eur??'—')+' EUR · '+a.created_at);
      if(canWrite)for(const decision of ['approve','reject'])button(section,decision==='approve'?'Approve':'Reject',async()=>{
        try{await api('/api/ai/approvals/'+a.id+'/'+decision,{method:'POST',body:{}});await approvals()}catch(e){error(e)}
      });
    }
  }
  async function runs(){
    body.replaceChildren();
    const data=await api('/api/ai/runs?limit=100');
    for(const run of data.items){
      const section=add(body,'section');section.className='card';
      button(section,run.agent_id+' · '+run.status+' · '+run.started_at,async()=>{
        try{const detail=await api('/api/ai/runs/'+run.id);const steps=add(section,'ol');steps.replaceChildren();for(const step of detail.steps)add(steps,'li',step.action+' · '+step.created_at)}catch(e){error(e)}
      });
    }
  }
  async function rules(){
    body.replaceChildren();
    const data=await api('/api/ai/notify-rules');
    for(const r of data.items){
      const section=add(body,'section');section.className='card';
      add(section,'p',r.match_kind+' · '+r.match_value+' → '+r.channel);
      if(canWrite){
        button(section,r.active?'Disable':'Enable',async()=>{try{await api('/api/ai/notify-rules/'+r.id,{method:'PATCH',body:{active:!r.active}});await rules()}catch(e){error(e)}});
        button(section,'Edit',async()=>{
          const value=prompt('Match value',r.match_value);
          if(value===null)return;
          try{await api('/api/ai/notify-rules/'+r.id,{method:'PATCH',body:{match_value:value}});await rules()}catch(e){error(e)}
        });
        button(section,'Delete',async()=>{
          if(!confirm('Delete this notification rule?'))return;
          try{await api('/api/ai/notify-rules/'+r.id,{method:'DELETE'});await rules()}catch(e){error(e)}
        });
      }
    }
    if(canWrite){
      const form=add(body,'form');form.className='card';
      const kind=add(form,'select');for(const v of ['function','from_domain','risk','amount_over']){const o=add(kind,'option',v);o.value=v}
      const value=add(form,'input');value.placeholder='Match value';value.required=true;
      const channel=add(form,'select');for(const v of ['instant','digest','count_only','never']){const o=add(channel,'option',v);o.value=v}
      const position=add(form,'input');position.type='number';position.value='0';position.min='0';
      const submit=add(form,'button','Add rule');submit.type='submit';
      form.addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/ai/notify-rules',{method:'POST',body:{match_kind:kind.value,match_value:value.value,channel:channel.value,position:Number(position.value),active:true}});await rules()}catch(err){error(err)}});
    }
  }
  for(const [name,fn] of [['Agents',agents],['Approvals',approvals],['Runs',runs],['Notify rules',rules]])button(tabs,name,()=>fn().catch(error));
  await agents();
}
