// Sales report (filters, EUR totals, CSV) and, for system_admin, the integration registry. No inline styles.
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n};
const dateTR=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\d/.test(s)?s.slice(8,10)+'.'+s.slice(5,7)+'.'+s.slice(0,4):'—';
const statusTR={pending:'Bekliyor',approved:'Onaylı',rejected:'Reddedildi',cancelled:'İptal',draft:'Taslak',awaiting_credit_approval:'Kredi onayı bekliyor'};
function labelled(text,el){const l=node('label');l.append(node('span',text),el);return l}
function input(name,type,value=''){const i=document.createElement('input');i.name=name;i.type=type;i.value=value;return i}

export async function reports(ctx){
  const {view,card,btn,api,message,errText,download}=ctx;
  const from=input('from','date'),to=input('to','date'),status=document.createElement('select');status.name='status';
  for(const[v,t]of[['','Tümü'],...Object.entries(statusTR)]){const o=node('option',t);o.value=v;status.append(o)}
  const filters=node('div',undefined,'fields');filters.append(labelled('Giriş tarihi (başlangıç)',from),labelled('Giriş tarihi (bitiş)',to),labelled('Durum',status));
  const qs=()=>{const p=new URLSearchParams();if(from.value)p.set('from',from.value);if(to.value)p.set('to',to.value);if(status.value)p.set('status',status.value);const s=p.toString();return s?'?'+s:''};
  const out=node('div');
  const run=async()=>{message('');out.replaceChildren();try{const r=await api('/api/reports/sales'+qs());render(out,r)}catch(e){message(e.code==='INVALID_REPORT_FILTER'?'Filtre geçersiz.':errText(e))}};
  const actions=node('div',undefined,'actions');
  actions.append(btn('Raporu göster',run,true,'report-run'),btn('CSV indir',async()=>{try{await download('/api/reports/sales.csv'+qs(),'bed4book-sales.csv')}catch(e){message(errText(e))}},false,'report-csv'));
  const box=node('div');box.append(filters,actions);
  view().append(card('Satış raporu',box),out);
  await run();
}

function render(root,r){
  const t=r.totals,sum=node('div',undefined,'grid');
  for(const[label,value]of[['Rezervasyon',t.bookings],['Sayılan (iptal/ret hariç)',t.countedBookings],['Toplam (EUR)',t.totalEur]]){const c=node('div',undefined,'card');c.append(node('div',label,'muted small'),node('div',value,'metric'));sum.append(c)}
  root.append(sum);
  if(t.missingRate)root.append(node('p',t.missingRate+' rezervasyonun kur bilgisi yok; EUR toplamına girmedi.','danger small'));
  if(!r.items.length){root.append(node('p','Bu filtrelerle rezervasyon yok.','empty'));return}
  const w=node('div',undefined,'scroll'),tb=node('table',undefined,'list');tb.dataset.testid='report-table';const head=node('tr');
  for(const x of['No','Durum','Giriş','Çıkış','Otel','Satıcı','Alıcı','Tutar','EUR'])head.append(node('th',x));tb.append(head);
  for(const b of r.items){const tr=node('tr');tr.append(node('td',b.booking_no),node('td',statusTR[b.status]||b.status),node('td',dateTR(b.check_in)),node('td',dateTR(b.check_out)),
    node('td',b.hotel_name),node('td',b.seller),node('td',b.buyer),node('td',b.total+' '+String(b.currency).trim()),node('td',b.total_eur??'—'));tb.append(tr)}
  w.append(tb);root.append(w);
}

export async function integrations(ctx){
  const {view,card,btn,api,message,errText}=ctx;
  const kinds=[['hotel_api','Otel API'],['channel_manager','Kanal yöneticisi'],['flight','Uçak'],['transfer','Transfer'],['payment','Ödeme'],['other','Diğer']];
  const form=node('form'),name=input('name','text'),kind=document.createElement('select');kind.name='kind';
  for(const[v,t]of kinds){const o=node('option',t);o.value=v;kind.append(o)}
  name.required=true;name.maxLength=200;
  const add=node('button','Bağlantı ekle','primary');add.type='submit';
  const f=node('div',undefined,'fields');f.append(labelled('Ad',name),labelled('Tür',kind));form.append(f,add);
  form.onsubmit=async ev=>{ev.preventDefault();try{await api('/api/integrations',{method:'POST',body:{kind:kind.value,name:name.value.trim()}});name.value='';await refresh()}catch(e){message(errText(e))}};
  const list=node('div',undefined,'scroll');
  view().append(card('Entegrasyonlar',(()=>{const d=node('div');d.append(node('p','Dış bağlantılar henüz kurulmadı; bu liste bağlantılar eklendiğinde durumlarını ve hatalarını gösterir.','muted small'),form);return d})()),card('Bağlantılar',list));
  async function refresh(){
    const items=(await api('/api/integrations')).items||[];list.replaceChildren();
    if(!items.length){list.append(node('p','Kayıtlı bağlantı yok.','empty'));return}
    const t=node('table',undefined,'list');const head=node('tr');for(const x of['Ad','Tür','Durum','Son çalışma','Son hata',''])head.append(node('th',x));t.append(head);
    for(const c of items){const tr=node('tr'),act=node('td');
      act.append(btn(c.status==='active'?'Kapat':'Aç',async()=>{try{await api('/api/integrations/'+c.id,{method:'PATCH',body:{status:c.status==='active'?'disabled':'active'}});await refresh()}catch(e){message(errText(e))}}));
      tr.append(node('td',c.name),node('td',(kinds.find(k=>k[0]===c.kind)||[,c.kind])[1]),node('td',c.status==='active'?'Açık':c.status==='error'?'Hata':'Kapalı'),node('td',c.last_run_at?dateTR(String(c.last_run_at)):'—'),node('td',c.last_error||'—'),act);t.append(tr)}
    list.append(t);
  }
  await refresh();
}
