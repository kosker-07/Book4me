// Excel contract import screen: choose file -> preview (nothing saved) -> terms + hotel selection -> confirm.
// No inline styles (CSP style-src 'self'); uses the existing card/list/chip/danger classes.
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n};
const errorText={INVALID_XLSX:'Dosya okunamadı. Geçerli bir .xlsx sözleşme dosyası seçin.',FILE_TOO_LARGE:'Dosya 10 MB sınırını aşıyor.',NO_HOTELS_FOUND:'Dosyada otel/oda bloğu bulunamadı.',
  DUPLICATE_IMPORT:'Bu dosya daha önce yüklenmiş.',ALREADY_CONFIRMED:'Bu önizleme zaten kaydedildi.',INVALID_RATE_PLAN_TERMS:'İptal ve ödeme koşulları eksik veya geçersiz.',
  OWNER_AGENCY_REQUIRED:'Sözleşmenin ait olduğu DMC\'yi seçin.',TOO_MANY_NIGHTS:'Dosyada çok fazla gece var; dosyayı bölün.',FILE_REQUIRED:'Dosya seçin.'};
const issueText={NO_ROOM_PRICE:'Çift kişilik oda fiyatı yok',INVALID_DATE_RANGE:'Geçersiz tarih aralığı',OVERLAPPING_PERIOD_LAST_WINS:'Dönemler çakışıyor, sonraki dönem geçerli',INVALID_CURRENCY:'Para birimi okunamadı',NO_HOTEL_NAME:'Otel adı okunamadı'};
const dateTR=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\d/.test(s)?s.slice(8,10)+'.'+s.slice(5,7)+'.'+s.slice(0,4):'—';

async function upload(file,ownerAgencyId){
  const q=ownerAgencyId?'?ownerAgencyId='+encodeURIComponent(ownerAgencyId):'';
  const res=await fetch('/api/contracts/import/preview'+q,{method:'POST',body:file,cache:'no-store',credentials:'same-origin',
    headers:{'Content-Type':'application/octet-stream','X-Requested-With':'bed4book','X-File-Name':encodeURIComponent(file.name).slice(0,200)}});
  let data={};try{data=await res.json()}catch{}
  if(!res.ok){const e=new Error(data.error||'HTTP_'+res.status);e.code=data.error||'HTTP_'+res.status;e.status=res.status;e.fields=data.fields;throw e}
  return data;
}
const say=(ctx,e)=>ctx.message(errorText[e.code]||ctx.errText(e));

function input(label,name,type,value,attrs={}){const l=node('label');l.append(node('span',label));const i=document.createElement(type==='select'?'select':'input');i.name=name;if(type!=='select'){i.type=type;i.value=String(value)}for(const[k,v]of Object.entries(attrs))i.setAttribute(k,v);l.append(i);return {l,i}}
function select(label,name,options,value){const s=input(label,name,'select');for(const[v,t]of options){const o=node('option',t);o.value=v;if(v===value)o.selected=true;s.i.append(o)}return s}

function termsForm(){
  const box=node('div',undefined,'fields');
  const parts=[input('Ücretsiz iptal (girişten kaç gün önceye kadar)','freeUntilDays','number',7,{min:'0',max:'365'}),
    select('İptal cezası türü','penaltyType',[['nights','Gece'],['percent','Yüzde']],'nights'),
    input('İptal cezası değeri','penaltyValue','number',1,{min:'1',max:'100'}),
    select('No-show cezası türü','noShowPenaltyType',[['nights','Gece'],['percent','Yüzde']],'percent'),
    input('No-show cezası değeri','noShowPenaltyValue','number',100,{min:'1',max:'100'}),
    input('Ödeme vadesi (girişten kaç gün önce)','dueDaysBeforeCheckIn','number',14,{min:'0',max:'365'})];
  for(const p of parts)box.append(p.l);
  const value=()=>{const v=Object.fromEntries(parts.map(p=>[p.i.name,p.i.value]));
    return {cancellationPolicy:{freeUntilDays:Number(v.freeUntilDays),penaltyType:v.penaltyType,penaltyValue:Number(v.penaltyValue),noShowPenaltyType:v.noShowPenaltyType,noShowPenaltyValue:Number(v.noShowPenaltyValue)},
      paymentTerms:{dueDaysBeforeCheckIn:Number(v.dueDaysBeforeCheckIn)}}};
  return {box,value};
}

function previewTable(hotels,checks){
  const wrap=node('div',undefined,'scroll'),table=node('table',undefined,'list');table.dataset.testid='import-preview';
  const head=node('tr');for(const t of['','Otel','Bölge','Konsept','Para','Oda','Gece','Fiyat aralığı','Uyarılar'])head.append(node('th',t));
  const thead=node('thead');thead.append(head);table.append(thead);const body=node('tbody');
  for(const h of hotels){
    const tr=node('tr'),cb=document.createElement('input');cb.type='checkbox';cb.checked=h.rooms.length>0;cb.disabled=!h.rooms.length;cb.dataset.index=String(h.index);cb.setAttribute('aria-label',h.name+' seç');checks.push(cb);
    const td0=node('td');td0.append(cb);tr.append(td0,node('td',h.name),node('td',h.region||'—'),node('td',h.concept||'—'),node('td',h.currency));
    const nights=h.rooms.reduce((n,r)=>n+r.nights,0),min=Math.min(...h.rooms.map(r=>Number(r.minPrice))),max=Math.max(...h.rooms.map(r=>Number(r.maxPrice)));
    tr.append(node('td',h.rooms.length),node('td',nights),node('td',h.rooms.length?min.toFixed(2)+' – '+max.toFixed(2):'—'));
    const issues=node('td');
    for(const e of h.errors.slice(0,5))issues.append(node('div',(e.room?e.room.slice(0,40)+': ':'')+(issueText[e.code]||e.code),'danger small'));
    if(h.errors.length>5)issues.append(node('div','+'+(h.errors.length-5)+' hata','danger small'));
    if(h.warnings.length)issues.append(node('div',h.warnings.length+' uyarı','muted small'));
    if(!h.errors.length&&!h.warnings.length)issues.append(node('span','Sorun yok','chip'));
    tr.append(issues);body.append(tr);
    for(const r of h.rooms){const rr=node('tr','', 'small');rr.append(node('td'),node('td','↳ '+r.name,'muted'),node('td'),node('td'),node('td'),node('td'),node('td',r.nights),node('td',r.minPrice+' – '+r.maxPrice),node('td',dateTR(r.firstNight)+' → '+dateTR(r.lastNight),'muted'));body.append(rr)}
  }
  table.append(body);wrap.append(table);return wrap;
}

export async function contractImport(ctx){
  const {view,card,btn,api,message,session}=ctx;
  const platform=['system_admin','back_office'].includes(session.user?.role);
  const form=node('form');form.dataset.testid='import-form';
  const file=input('Sözleşme dosyası (.xlsx, en fazla 10 MB)','file','file','',{accept:'.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','data-testid':'import-file'});file.i.value='';
  let owner=null;
  if(platform){const agencies=((await api('/api/admin/agencies')).items||[]).filter(a=>a.type==='master');owner=select('DMC','ownerAgencyId',[['','Seçin'],...agencies.map(a=>[a.id,a.name])],'');form.append(owner.l)}
  form.append(file.l,node('p','Önce önizleme gösterilir; onaylamadan hiçbir şey kaydedilmez. Fiyatlar çift kişilik oda fiyatıdır.','muted small'));
  const go=node('button','Önizle','primary');go.type='submit';go.dataset.testid='import-preview-btn';form.append(go);
  const result=node('div');
  form.onsubmit=async ev=>{ev.preventDefault();message('');result.replaceChildren();const f=file.i.files?.[0];if(!f)return message(errorText.FILE_REQUIRED);
    if(platform&&!owner.i.value)return message(errorText.OWNER_AGENCY_REQUIRED);
    go.disabled=true;try{showPreview(ctx,result,await upload(f,owner?.i.value))}catch(e){say(ctx,e)}finally{go.disabled=false}};
  view().append(card('Sözleşme yükle (Excel)',form),result);
  await history(ctx);
}

function showPreview(ctx,root,data){
  const {card,btn,api,message}=ctx,checks=[];
  const skipped=data.skipped?.length?node('p','Okunmayan sayfalar: '+data.skipped.map(s=>s.sheet).join(', '),'muted small'):node('span');
  const terms=termsForm();
  const save=btn('Onayla ve kaydet',async()=>{const hotels=checks.filter(c=>c.checked).map(c=>Number(c.dataset.index));if(!hotels.length)return message('En az bir otel seçin.');
    save.disabled=true;try{const r=await api('/api/contracts/import/'+data.importId+'/confirm',{method:'POST',body:{...terms.value(),hotels}});
      root.replaceChildren(card('Kaydedildi',done(r)));message('')}catch(e){say(ctx,e)}finally{save.disabled=false}},true,'import-confirm');
  root.append(card('Önizleme · '+data.hotels.length+' otel',(()=>{const d=node('div');d.append(previewTable(data.hotels,checks),skipped);return d})()),
    card('İptal ve ödeme koşulları (zorunlu, tüm fiyat planlarına uygulanır)',(()=>{const d=node('div');d.append(terms.box,save);return d})()));
}

function done(r){
  const d=node('div');d.dataset.testid='import-result';
  for(const h of r.hotels)d.append(node('p',h.name+': '+h.rooms+' oda, '+h.nights+' gece'+(h.createdHotel?' (yeni otel, taslak)':'')));
  for(const s of r.skipped)d.append(node('p',s.name+': atlandı ('+s.reason+')','danger'));
  d.append(node('p','Yeni oteller "taslak" olarak açılır; Oteller ekranından kontrol edip yayına alın.','muted small'));
  return d;
}

async function history(ctx){
  const {view,card,api}=ctx;
  let items=[];try{items=(await api('/api/contracts/imports')).items||[]}catch{return}
  if(!items.length)return;
  const t=node('table',undefined,'list');const head=node('tr');for(const x of['Dosya','Durum','Tarih','Sonuç'])head.append(node('th',x));t.append(head);
  for(const i of items.slice(0,20)){const tr=node('tr');const name=i.file_name;
    tr.append(node('td',name||'—'),node('td',i.status==='confirmed'?'Kaydedildi':'Önizleme'),node('td',dateTR(String(i.created_at))),node('td',i.result?i.result.hotels.length+' otel':'—'));t.append(tr)}
  const w=node('div',undefined,'scroll');w.append(t);view().append(card('Son yüklemeler',w));
}
