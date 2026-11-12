// DMC panel (master_agency only): own sub-agencies (create, activate, credit limit, bulk margin) and credit approvals.
// No inline styles (CSP style-src 'self').
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n};
const dateTR=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\d/.test(s)?s.slice(8,10)+'.'+s.slice(5,7)+'.'+s.slice(0,4):'—';
const errorText={INVALID_MARKUP:'Kâr oranı 0 ile 100 arasında olmalı (en fazla 3 ondalık).',INVALID_CREDIT_LIMIT:'Kredi limiti geçersiz.',SUBAGENCY_INACTIVE:'Pasif alt acenteye yayın açılamaz.',
  INVALID_SUBAGENCY:'Alt acente bilgileri geçersiz.',ALLOTMENT_UNAVAILABLE:'Kontenjan yetersiz; rezervasyon onaylanamadı.',PRICE_CHANGED:'Fiyat değişmiş; rezervasyon onaylanamadı.'};
function input(name,type,value,attrs={}){const i=document.createElement('input');i.name=name;i.type=type;i.value=value===null||value===undefined?'':String(value);for(const[k,v]of Object.entries(attrs))i.setAttribute(k,v);return i}
const say=(ctx,e)=>ctx.message(errorText[e.code]||ctx.errText(e));

export async function dmcSubagencies(ctx){
  const {view,card,btn,api,message}=ctx;
  const form=node('form'),name=input('name','text','',{required:'',maxlength:'200','aria-label':'Alt acente adı','data-testid':'dmc-sub-name'});
  const add=node('button','Alt acente ekle','primary');add.type='submit';
  const row=node('div',undefined,'row');row.append(name,add);form.append(row);
  form.onsubmit=async ev=>{ev.preventDefault();try{await api('/api/dmc/subagencies',{method:'POST',body:{name:name.value.trim()}});message('');await refresh()}catch(e){say(ctx,e)}};
  const list=node('div',undefined,'scroll');
  view().append(card('Yeni alt acente',form),card('Alt acentelerim',list));
  async function refresh(){
    const items=(await api('/api/dmc/subagencies')).items||[];list.replaceChildren();
    if(!items.length){list.append(node('p','Henüz alt acente yok.','empty'));return}
    const t=node('table',undefined,'list');t.dataset.testid='dmc-sub-table';const head=node('tr');
    for(const x of['Alt acente','Durum','Kredi limiti (EUR)','Kâr oranı (%)',''])head.append(node('th',x));t.append(head);
    for(const s of items){
      const tr=node('tr'),limit=input('limit','number',s.credit_limit_eur,{min:'0',step:'0.01','aria-label':s.name+' kredi limiti',placeholder:'Limitsiz'});
      const markup=input('markup','number','',{min:'0',max:'100',step:'0.001','aria-label':s.name+' kâr oranı',placeholder:'Değiştirme'});
      const all=input('publishAll','checkbox','',{'aria-label':s.name+' tüm otellerimi aç'});const allL=node('label',undefined,'small');allL.append(all,node('span','Tüm otellerimi aç'));
      const status=btn(s.active?'Aktif · pasife al':'Pasif · aktifleştir',async()=>{try{await api('/api/dmc/subagencies/'+s.id,{method:'PATCH',body:{active:!s.active}});await refresh()}catch(e){say(ctx,e)}});
      const save=btn('Kaydet',async()=>{try{
        const lim=limit.value.trim()===''?null:limit.value.trim();
        if(lim!==(s.credit_limit_eur??null))await api('/api/dmc/subagencies/'+s.id,{method:'PATCH',body:{creditLimitEur:lim}});
        if(markup.value.trim()!==''){const r=await api('/api/dmc/subagencies/'+s.id+'/markup',{method:'PUT',body:{markupPercent:Number(markup.value),publishAll:all.checked}});
          message(s.name+': '+r.updated+' yayın güncellendi'+(r.published?', '+r.published+' yeni yayın açıldı':'')+(r.skippedNoTerms?', '+r.skippedNoTerms+' fiyat planı koşulsuz olduğu için atlandı':'')+'.')}
        else message(s.name+' kaydedildi.');
        await refresh()}catch(e){say(ctx,e)}},true);
      const tdName=node('td',s.name),tdS=node('td'),tdL=node('td'),tdM=node('td'),tdA=node('td');
      tdS.append(status);tdL.append(limit);tdM.append(markup,allL);tdA.append(save);tr.append(tdName,tdS,tdL,tdM,tdA);t.append(tr);
    }
    list.append(t,node('p','Kâr oranı, bu alt acenteye açık olan tüm otellerinizin yayınlarına birlikte uygulanır; mevcut rezervasyonların fiyatı değişmez. Kredi limiti boş = limitsiz.','muted small'));
  }
  await refresh();
}

export async function dmcApprovals(ctx){
  const {view,card,btn,api,message}=ctx;
  const box=node('div',undefined,'scroll');view().append(card('Kredi onayı bekleyen rezervasyonlar',box));
  async function refresh(){
    const items=(await api('/api/dmc/credit-approvals')).items||[];box.replaceChildren();
    if(!items.length){box.append(node('p','Onay bekleyen rezervasyon yok.','empty'));return}
    const t=node('table',undefined,'list');t.dataset.testid='dmc-approvals';const head=node('tr');
    for(const x of['Rezervasyon','Alt acente','Otel','Tarih','Tutar',''])head.append(node('th',x));t.append(head);
    for(const b of items){
      const tr=node('tr'),act=node('td');
      const decide=async(kind)=>{try{await api('/api/dmc/credit-approvals/'+b.id+'/'+kind,{method:'POST'});message(b.booking_no+(kind==='approve'?' onaylandı.':' reddedildi.'));await refresh()}catch(e){say(ctx,e)}};
      act.append(btn('Onayla',()=>decide('approve'),true),btn('Reddet',()=>decide('reject')));
      tr.append(node('td',b.booking_no),node('td',b.agency_name),node('td',b.hotel_name),node('td',dateTR(b.check_in)+' → '+dateTR(b.check_out)),node('td',b.total+' '+b.currency),act);t.append(tr);
    }
    box.append(t,node('p','Onay bekleyen rezervasyon stok tutmaz; onayda fiyat ve kontenjan yeniden kontrol edilir.','muted small'));
  }
  await refresh();
}
