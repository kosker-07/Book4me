// Standalone owner assistant widget; embed in AI Center when PR-D is merged.
export function ownerAssistantWidget({parent,api,message,errText}) {
  const form=document.createElement('form');form.className='card';
  const title=document.createElement('h2');title.textContent='Owner Assistant';form.append(title);
  const question=document.createElement('textarea');question.placeholder='Ask about BED4BOOK operations';
  question.required=true;question.maxLength=4000;question.setAttribute('aria-label','Ask Owner Assistant');
  form.append(question);
  const send=document.createElement('button');send.type='submit';send.textContent='Ask';form.append(send);
  const answer=document.createElement('p');answer.setAttribute('aria-live','polite');form.append(answer);
  form.addEventListener('submit',async event=>{
    event.preventDefault();send.disabled=true;
    try{
      const data=await api('/api/ai/assistant/ask',{method:'POST',body:{question:question.value}});
      answer.textContent=data.answer||(data.status==='disabled'?'Assistant disabled':data.status==='failed'?'AI not configured':'No response');
    }catch(e){message(errText(e))}
    finally{send.disabled=false}
  });
  parent.append(form);
}
