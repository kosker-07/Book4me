import {api,download,signIn,signOut,session,resetSession,errText} from './service.js';
const $=id=>document.getElementById(id), node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n};
const el=(tag,props={},children=[])=>{const n=node(tag,props.text,props.cls);for(const [k,v] of Object.entries(props)){if(k==='text'||k==='cls')continue;if(k==='testid')n.dataset.testid=v;else if(k==='onClick')n.addEventListener('click',v);else if(k==='onChange')n.addEventListener('change',v);else n[k]=v}for(const c of children)n.append(c);return n};
const btn=(label,fn,primary=false,testid)=>el('button',{text:label,cls:primary?'primary':'ghost',type:'button',testid,onClick:fn});
const field=(label,name,type='text',value='',testid)=>el('label',{},[node('span',label),el(type==='textarea'?'textarea':'input',{name,type:type==='textarea'?undefined:type,value,testid,required:!['search','number'].includes(type)})]);
const card=(title,content)=>el('section',{cls:'card'},[node('h2',title),content]);
const wrap=(...children)=>el('div',{},children);
const show=(id,yes)=>$(id).classList.toggle('hidden',!yes);
const view=()=>$('view');
const clear=()=>view().replaceChildren();
const message=(s)=>{const t=$('toast');t.textContent=s;show('toast',!!s)};
const roleNames={system_admin:'Sistem yöneticisi',back_office:'Operasyon',master_agency:'Ana acente',sub_agency:'Acente'};
const dateTR=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\d/.test(s)?s.slice(8,10)+'.'+s.slice(5,7)+'.'+s.slice(0,4):String(s??'');
const money=(value,currency)=>String(value??'—')+' '+String(currency??'');
const today=()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)};
const plus=(d,n)=>{const v=new Date(d+'T12:00:00Z');v.setUTCDate(v.getUTCDate()+n);return v.toISOString().slice(0,10)};
const nights=(a,b)=>Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000);
const navAgency=[['search','Otel arama'],['bookings','Rezervasyonlarım'],['account','Hesabım'],['soon-transfer','Transfer · Yakında'],['soon-tour','Tur · Yakında'],['soon-flight','Uçak · Yakında'],['soon-balance','Cari / bakiye · Yakında'],['soon-reports','Raporlar · Yakında']];
const navAdmin=[['dashboard','Panel'],['bookings','Rezervasyonlar'],['hotels','Oteller'],['markets','Pazarlar'],['agencies','Acenteler ve kullanıcılar'],['currencies','Para birimleri ve kurlar'],['account','Hesabım'],['soon-transfer','Transfer · Yakında'],['soon-tour','Tur · Yakında'],['soon-flight','Uçak · Yakında'],['soon-accounting','Muhasebe · Yakında'],['soon-reports','Raporlar · Yakında'],['soon-rebooking','Rebooking · Yakında'],['soon-h2h','Entegrasyonlar / H2H · Yakında'],['soon-brand','Platform markası · Yakında']];
let page='',bookingRows=[],offers=[],searchRequest=null,searchRooms=[{adults:2,ages:[]}],quote=null,bookingKey=null,selectedBooking=null;
const isAgency=()=>session.user?.role==='sub_agency';
const bookingBase=()=>isAgency()?'/api/agency/bookings':'/api/backoffice/bookings';
function fail(e){if(e.status===401){resetSession();setAuth(false);message('Oturum sona erdi. Yeniden giriş yapın.');return}message(errText(e))}
function setAuth(ok){show('login',!ok);show('app',ok);show('logout',ok);$('menuToggle').classList.toggle('hidden',!ok);$('userBadge').textContent=ok?(roleNames[session.user.role]||session.user.role):'';if(ok)nav()}
function nav(){const root=$('navItems');root.replaceChildren();for(const [id,label] of(isAgency()?navAgency:navAdmin)){const b=btn(label,()=>go(id));b.dataset.testid='nav-'+id;b.classList.toggle('active',id===page);root.append(b)}}
async function go(id){page=id;$('sidebar').classList.remove('open');$('menuToggle').setAttribute('aria-expanded','false');nav();clear();message('');const title=(isAgency()?navAgency:navAdmin).find(x=>x[0]===id)?.[1]||id;$('pageTitle').textContent=title;try{if(id.startsWith('soon-'))return soon(title);if(id==='account')return account();if(id==='search')return search();if(id==='bookings')return await bookings();if(id==='dashboard')return await dashboard();if(id==='hotels')return await hotels();if(id==='markets')return await markets();if(id==='currencies')return await currencies();if(id==='agencies')return await agencies();return soon(title)}catch(e){fail(e);view().append(node('div','Veri yüklenemedi.','card empty'))}}
function soon(name){view().append(card(name,wrap(node('p','Bu modül için kullanılabilir API veya tamamlanmış arayüz henüz bulunmuyor.'),node('span','Yakında','chip'))))}
$('menuToggle').onclick=()=>{const open=$('sidebar').classList.toggle('open');$('menuToggle').setAttribute('aria-expanded',String(open))};
$('loginForm').onsubmit=async e=>{e.preventDefault();message('');const f=new FormData(e.currentTarget);try{await signIn(f.get('email'),f.get('password'));e.currentTarget.reset();setAuth(true);go(isAgency()?'search':'dashboard')}catch(err){fail(err)}};
$('logout').onclick=async()=>{await signOut();setAuth(false);clear()};
async function account(){const form=el('form',{},[field('Mevcut şifre','currentPassword','password'),field('Yeni şifre (en az 12 karakter)','newPassword','password'),el('button',{text:'Şifreyi değiştir',cls:'primary',type:'submit'})]);form.onsubmit=async e=>{e.preventDefault();const f=new FormData(form);if(String(f.get('newPassword')).length<12)return message('Yeni şifre en az 12 karakter olmalı.');try{await api('/api/auth/change-password',{method:'POST',body:Object.fromEntries(f)});await signOut();setAuth(false);message('Şifre değiştirildi. Yeniden giriş yapın.')}catch(err){fail(err)}};view().append(card('Hesap güvenliği',form))}
async function dashboard(){const data=await api('/api/backoffice/bookings');bookingRows=Array.isArray(data.items)?data.items:[];const statuses=[...new Set(bookingRows.map(b=>b.status))];const grid=el('div',{cls:'grid'},[metric('Listelenen rezervasyon',bookingRows.length),...statuses.map(s=>metric(s,bookingRows.filter(b=>b.status===s).length))]);view().append(card('Gerçek rezervasyon verileri',wrap(grid,node('p','Sayılar API tarafından döndürülen en fazla 500 rezervasyona aittir.','muted small'))))}
function metric(label,value){return el('div',{cls:'card'},[node('div',label,'eyebrow'),node('div',value,'metric')])}
async function bookings(){const data=await api(bookingBase());bookingRows=Array.isArray(data.items)?data.items:[];const list=el('div',{cls:'scroll'}),table=el('table',{cls:'list'}),head=el('tr');for(const x of ['Rezervasyon','Otel','Tarih','Durum','Toplam',''])head.append(node('th',x));table.append(head);for(const b of bookingRows){const tr=el('tr',{testid:'booking-row'});for(const x of [b.booking_no,b.hotel_name,dateTR(b.check_in),statusTR[b.status]||b.status,money(b.total,b.currency)])tr.append(node('td',x));tr.append(el('td',{},[btn('Detay',()=>bookingDetail(b.id),false,'booking-detail')]));table.append(tr)}list.append(table);view().append(card('Rezervasyon kayıtları',bookingRows.length?list:node('div','Henüz rezervasyon yok.','empty')))}
async function bookingDetail(id){const b=await api(bookingBase()+'/'+encodeURIComponent(id));selectedBooking=b;clear();const d=el('div',{},[node('p','Rezervasyon: '+String(b.booking_no||b.id)),node('p','Otel: '+String(b.hotel_name||'')),node('p','Durum: '+(statusTR[b.status]||b.status)),node('p','Konaklama: '+dateTR(b.check_in)+' – '+dateTR(b.check_out)),node('p','Toplam: '+money(b.total,b.currency))]);if(Array.isArray(b.nights))for(const n of b.nights)d.append(node('p',dateTR(n.date)+' · '+money(n.sell_price,n.currency)));if(Array.isArray(b.room_occupancies))b.room_occupancies.forEach((room,i)=>d.append(node('p','Oda '+(i+1)+': '+room.adults+' yetişkin, '+room.children+' çocuk'+(room.childAges?.length?' ('+room.childAges.join(', ')+' yaş)':''))));if(Array.isArray(b.guests))b.guests.forEach(g=>d.append(node('p','Misafir: '+g.first_name+' '+g.last_name+' · '+(g.nationality||''))));if(b.priceSnapshot)d.append(node('p','Kontrat: '+(b.priceSnapshot.contract_name||b.priceSnapshot.contract_code||'')+' · Ödeme: '+money(b.priceSnapshot.payment_amount,b.priceSnapshot.payment_currency)));const acts=el('div',{cls:'actions'});acts.append(btn('Voucher PDF',()=>pdf(id,'voucher'),false,'voucher-button'),btn('Proforma PDF',()=>pdf(id,'proforma'),false,'proforma-button'));if(isAgency()){if(b.status==='draft')acts.append(btn('Taslağı gönder',()=>submitDraft(id),true,'submit-draft-button'));if(['draft','pending'].includes(b.status))acts.append(btn('İptal et',()=>cancelBooking(id),false,'cancel-button'))}else{if(['pending','draft','approved'].includes(b.status)){const select=el('select',{testid:'status-select'});for(const s of ['approved','rejected',...(session.user.role==='master_agency'?[]:['cancelled'])])select.append(el('option',{text:statusTR[s]||s,value:s}));acts.append(select,btn('Durumu güncelle',async()=>{askInline('Rezervasyon durumu '+(statusTR[select.value]||select.value)+' olarak değiştirilsin mi?',async()=>{await api('/api/backoffice/bookings/'+id+'/status',{method:'PATCH',body:{status:select.value}});await bookingDetail(id)})}))}if(['system_admin','back_office'].includes(session.user.role))acts.append(btn('Proforma yeniden düzenle',async()=>{try{await api('/api/backoffice/bookings/'+id+'/proforma/reissue',{method:'POST',body:{}});message('Proforma yeniden düzenlendi.')}catch(e){fail(e)}}))}view().append(card('Rezervasyon detayı',wrap(d,acts,btn('Listeye dön',()=>go('bookings')))))}
async function pdf(id,type){try{await download(bookingBase()+'/'+encodeURIComponent(id)+'/'+type,type+'-'+id+'.pdf')}catch(e){fail(e)}}
async function submitDraft(id){try{await api('/api/agency/bookings/'+id+'/submit',{method:'POST',body:{}});bookingDetail(id)}catch(e){fail(e)}}
async function cancelBooking(id){askInline('Bu rezervasyon iptal edilsin mi?',async()=>{await api('/api/agency/bookings/'+id+'/cancel',{method:'POST',body:{}});await bookingDetail(id)});return;try{await api('/api/agency/bookings/'+id+'/cancel',{method:'POST',body:{}});bookingDetail(id)}catch(e){fail(e)}}
function search(){const form=el('form',{id:'searchForm'}),fields=el('div',{cls:'fields'});const loc=field('Lokasyon / otel adı (sonuçlarda filtrelenir)','location','search','','search-location'),ci=field('Giriş tarihi','checkIn','date',plus(today(),1),'search-checkin'),co=field('Çıkış tarihi','checkOut','date',plus(today(),4),'search-checkout');fields.append(loc,ci,co);const stayInfo=node('p','3 gece','muted');const roomRoot=el('div',{id:'roomRoot'}),natRoot=el('div',{id:'natRoot'});const count=el('p',{cls:'muted'});const update=()=>{const data=new FormData(form),a=data.get('checkIn'),b=data.get('checkOut');stayInfo.textContent=Number.isFinite(nights(a,b))?nights(a,b)+' gece':'Tarih seçin';count.textContent=searchRooms.length+' oda · '+searchRooms.reduce((n,r)=>n+r.adults,0)+' yetişkin · '+searchRooms.reduce((n,r)=>n+r.ages.length,0)+' çocuk';renderNats(natRoot)};ci.querySelector('input').addEventListener('change',update);co.querySelector('input').addEventListener('change',update);function renderRooms(){roomRoot.replaceChildren();searchRooms.forEach((r,i)=>{const section=el('div',{cls:'room'},[node('h3','Oda '+(i+1))]);const adults=field('Yetişkin','adults','number',r.adults,i===0?'search-adults':'search-adults-'+i);const ai=adults.querySelector('input');ai.min=1;ai.max=10;ai.onchange=()=>{r.adults=Number(ai.value);update()};const kids=field('Çocuk','children','number',r.ages.length,i===0?'search-children':'search-children-'+i);const ki=kids.querySelector('input');ki.min=0;ki.max=9;ki.onchange=()=>{const n=Number(ki.value);if(!Number.isInteger(n)||n<0||n>9)return message('Çocuk sayısı 0–9 olmalı.');r.ages=Array.from({length:n},(_,k)=>r.ages[k]??8);renderRooms()};section.append(adults,kids);r.ages.forEach((age,k)=>{const ageField=field('Çocuk '+(k+1)+' yaşı (0–17)','age','number',age,'search-child-age-'+i+'-'+k);const inp=ageField.querySelector('input');inp.min=0;inp.max=17;inp.onchange=()=>{r.ages[k]=Number(inp.value)};section.append(ageField)});if(searchRooms.length>1)section.append(btn('Odayı kaldır',()=>{searchRooms.splice(i,1);renderRooms()}));roomRoot.append(section)});update()}const add=btn('+ Oda ekle',()=>{if(searchRooms.length>=10)return message('En fazla 10 oda.');searchRooms.push({adults:2,ages:[]});renderRooms()},false,'search-rooms');const submit=el('button',{text:'Otelleri ara',cls:'primary',type:'submit',testid:'search-submit'});form.append(fields,stayInfo,node('h2','Oda ve misafirler'),add,roomRoot,count,node('h2','Aile milliyeti'),natRoot,el('div',{cls:'notice',text:'Seçilen milliyet tüm aile için geçerlidir. Yetişkin ve çocuk kapasitesi her oda için ayrı ayrı kontrol edilir.'}),el('div',{cls:'notice',text:'Lokasyon sunucuya gönderilmez; yalnızca API sonuçlarındaki otel adı ve konum metnini filtreler. Acente için ödeme para birimi listesi API üzerinden sunulmadığından seçim gösterilmiyor.'}),submit);form.onsubmit=async e=>{e.preventDefault();message('');const f=new FormData(form),checkIn=f.get('checkIn'),checkOut=f.get('checkOut'),num=nights(checkIn,checkOut),adults=searchRooms.reduce((n,r)=>n+r.adults,0),childAges=searchRooms.flatMap(r=>r.ages),nats=[...natRoot.querySelectorAll('input')].map(x=>x.value.trim().toUpperCase());if(checkIn<today()||!Number.isInteger(num)||num<1||num>60)return message('Konaklama 1–60 gece olmalı; tarih geçmişte olamaz.');if(searchRooms.some(r=>!Number.isInteger(r.adults)||r.adults<1||r.adults+r.ages.length>10||r.ages.some(a=>!Number.isInteger(a)||a<0||a>17)))return message('Her odada en az bir yetişkin olmalı; oda kapasitesi ve çocuk yaşlarını kontrol edin.');if(nats.length!==1||!/^[A-Z]{2}$/.test(nats[0]))return message('Ailenin tamamı için iki harfli tek milliyet kodu girin.');searchRequest={checkIn,checkOut,rooms:searchRooms.length,adults,children:childAges.length,childAges,roomOccupancies:searchRooms.map(r=>({adults:r.adults,children:r.ages.length,childAges:[...r.ages]})),nationalities:nats};const result=$('searchResults');result.replaceChildren(node('div','Gerçek müsaitlik sorgulanıyor…','card'));submit.disabled=true;try{const data=await api('/api/agency/searches',{method:'POST',body:searchRequest});offers=Array.isArray(data.results)?data.results:[];renderOffers(String(f.get('location')||''))}catch(err){result.replaceChildren(node('div','Arama başarısız.','card'));fail(err)}finally{submit.disabled=false}};view().append(card('Otel arama',form),el('section',{id:'searchResults'}));renderRooms()}
function renderNats(root){const old=root.querySelector('input')?.value||'TR';root.replaceChildren();const grid=el('div',{cls:'fields'});const f=field('Ailenin milliyeti (ISO ülke kodu)','nationality','text',old,'search-nationality-0');const inp=f.querySelector('input');inp.maxLength=2;inp.placeholder='TR';grid.append(f);root.append(grid)}

function renderOffers(initial=''){const root=$('searchResults');root.replaceChildren();const filters=el('div',{cls:'card filters'}),controls=el('div',{cls:'fields'});const location=field('Otel / lokasyon','location','search',initial,'filter-location');controls.append(location);const sort=el('select',{testid:'sort-select'});for(const [v,t] of [['low','Fiyat artan'],['high','Fiyat azalan'],['name','Otel adı']])sort.append(el('option',{value:v,text:t}));controls.append(el('label',{},[node('span','Sıralama'),sort]));const cats=[...new Set(offers.map(o=>o.hotel?.category).filter(x=>x!==null&&x!==undefined))],boards=[...new Set(offers.map(o=>o.board).filter(Boolean))];const makeSelect=(label,values,testid)=>{const s=el('select',{testid});s.append(el('option',{value:'',text:'Tümü'}));for(const v of values)s.append(el('option',{value:String(v),text:String(v)}));controls.append(el('label',{},[node('span',label),s]));return s};const category=cats.length?makeSelect('Kategori',cats,'filter-category'):null,board=boards.length?makeSelect('Pansiyon',boards,'filter-board'):null;const amounts=offers.map(o=>Number(o.total)).filter(Number.isFinite);let maxPrice=null;const currencies=[...new Set(offers.map(o=>o.currency))];if(amounts.length&&currencies.length===1){const f=field('Azami toplam fiyat (teklif para biriminde)','price','number','','filter-price');maxPrice=f.querySelector('input');maxPrice.min=0;controls.append(f)}filters.append(controls);const list=el('div');root.append(filters,list);function paint(){list.replaceChildren();const q=location.querySelector('input').value.trim().toLocaleLowerCase('tr');const filtered=offers.filter(o=>(String(o.hotel?.name||'')+' '+String(o.hotel?.location||'')).toLocaleLowerCase('tr').includes(q)&&(!category||!category.value||String(o.hotel?.category)===category.value)&&(!board||!board.value||String(o.board)===board.value)&&(!maxPrice||!maxPrice.value||Number(o.total)<=Number(maxPrice.value)));filtered.sort((a,b)=>a.currency!==b.currency?String(a.currency).localeCompare(String(b.currency)):sort.value==='name'?String(a.hotel?.name).localeCompare(String(b.hotel?.name),'tr'):(Number(a.total)-Number(b.total))*(sort.value==='high'?-1:1));if(!filtered.length){list.append(node('div','Bu koşullarda sonuç bulunamadı.','card empty'));return}for(const o of filtered){const details=el('div',{},[node('h2',o.hotel?.name||'Otel'),node('p',String(o.hotel?.location||'Konum belirtilmemiş')),node('p','Kategori: '+String(o.hotel?.category??'Belirtilmemiş')+' · Oda: '+String(o.room?.name||'')+' · Pansiyon: '+String(o.board||'')),node('p',dateTR(o.checkIn)+' – '+dateTR(o.checkOut)+' · '+nights(o.checkIn,o.checkOut)+' gece · '+o.rooms+' oda · '+searchRequest.adults+' yetişkin · '+searchRequest.children+' çocuk'),node('p','İptal koşulu: '+policy(o.cancellationPolicy)),node('p','Ödeme koşulu: '+policy(o.paymentTerms))]);const price=el('div',{},[node('div',money(o.total,o.currency),'price'),node('p',o.payment&&o.payment.currency!==o.currency?'Ödeme: '+money(o.payment.total,o.payment.currency):'','small')]);const detail=btn('Teklif detayı',()=>offerDetail(o),false,'result-detail');price.append(detail,btn('Rezervasyon',()=>bookingForm(o),true,'book-button'));list.append(el('article',{cls:'card offer result',testid:'result-card'},[details,price]))}}for(const inp of controls.querySelectorAll('input,select'))inp.addEventListener('input',paint);paint()}
function policy(x){return typeof x==='string'?x: x===null||x===undefined?'Belirtilmemiş':JSON.stringify(x)}
function offerDetail(o){clear();const box=el('div',{},[node('h2',o.hotel?.name||'Otel'),node('p','Oda: '+String(o.room?.name||'')+' · '+String(o.board||'')),node('p','İptal ve ödeme koşulları: '+termsText(o.cancellationPolicy,o.paymentTerms)),node('p','Toplam: '+money(o.total,o.currency))]);for(const n of o.nights||[])box.append(node('p',dateTR(n.date)+' · '+money(n.price,o.currency)));if(o.fx)box.append(node('p','Kur: '+policy(o.fx)));box.append(btn('Rezervasyona geç',()=>bookingForm(o),true,'book-button'),btn('Aramaya dön',()=>go('search')));view().append(card('Teklif ayrıntıları',box))}
function bookingForm(o){quote=o;bookingKey=crypto.randomUUID();clear();const form=el('form',{}),guestFields=el('div',{cls:'fields'});for(const [label,key,type] of [['Ad','firstName','text'],['Soyad','lastName','text'],['E-posta','email','email'],['Telefon','phone','tel'],['Aile milliyeti (ISO)','nationality','text']])guestFields.append(field(label,key,type,key==='nationality'?searchRequest.nationalities[0]:'','guest-'+key));const extras=el('div',{cls:'grid'});const other=[];for(let i=1;i<searchRequest.adults;i++)other.push({type:'adult',age:null});for(const age of searchRequest.childAges)other.push({type:'child',age});other.forEach((g,i)=>{const section=el('div',{cls:'room'},[node('h3',(g.type==='adult'?'Yetişkin ':'Çocuk ')+(i+1)),field('Ad','firstName','text','','guest-other-'+i+'-firstName'),field('Soyad','lastName','text','','guest-other-'+i+'-lastName'),node('p','Aile milliyeti aramada seçildi.','muted')]);extras.append(section)});const note=field('Operasyon notu','operationNote','textarea','','guest-operationNote');const submit=el('button',{text:'Rezervasyonu oluştur',cls:'primary',type:'submit',testid:'booking-submit'}),draft=btn('Taslak oluştur',()=>{form.dataset.draft='true';form.requestSubmit()},false,'submit-draft-button');form.append(node('p','Toplam: '+money(o.total,o.currency)),guestFields,node('h2','Diğer misafirler'),extras,note,el('div',{cls:'actions'},[submit,draft]));form.onsubmit=async e=>{e.preventDefault();const f=new FormData(form),lead={firstName:f.get('firstName'),lastName:f.get('lastName'),email:f.get('email'),phone:f.get('phone'),nationality:String(f.get('nationality')||'').toUpperCase(),adults:searchRequest.adults,children:searchRequest.children,childAges:searchRequest.childAges},otherGuests=[...extras.children].map((section,i)=>{const inputs=section.querySelectorAll('input');return {...other[i],firstName:inputs[0].value,lastName:inputs[1].value,nationality:lead.nationality}});if(!/^[A-Z]{2}$/.test(lead.nationality)||lead.nationality!==searchRequest.nationalities[0])return message('Aile milliyeti aramada seçilen milliyetle aynı olmalı.');submit.disabled=true;try{const result=await api('/api/agency/bookings',{method:'POST',headers:{'Idempotency-Key':bookingKey},body:{quoteId:o.quoteId,guest:lead,otherGuests,operationNote:f.get('operationNote'),draft:form.dataset.draft==='true'}});message('Rezervasyon isteği alındı.');bookingKey=null;go('bookings')}catch(err){fail(err);if(['PRICE_CHANGED','ALLOTMENT_UNAVAILABLE','QUOTE_EXPIRED'].includes(err.code))message('Fiyat veya kontenjan değişti. Lütfen yeniden arama yapın.')}finally{submit.disabled=false;delete form.dataset.draft}};view().append(card('Rezervasyon bilgileri',form))}
const statusTR={draft:'Taslak',pending:'Bekliyor',approved:'Onaylandı',rejected:'Reddedildi',cancelled:'İptal edildi',active:'Aktif',inactive:'Pasif'};
const selectField=(label,name,options,value='')=>el('label',{},[node('span',label),el('select',{name},options.map(([v,t])=>el('option',{value:v,text:t,selected:String(v)===String(value)})))]);
const formValues=form=>Object.fromEntries(new FormData(form));
function editor(title,url,method,fields,done,transform=x=>x){
 const form=el('form');
 for(const spec of fields){
  const [label,name,type='text',value='']=spec;
  form.append(type==='select'?selectField(label,name,value.options,value.selected):field(label,name,type,value));
 }
 form.append(el('button',{text:'Kaydet',type:'submit',cls:'primary'}));
 form.onsubmit=async ev=>{ev.preventDefault();const raw=formValues(form);try{await api(url,{method,body:transform(raw)});message('Kaydedildi.');await done()}catch(err){fail(err)}};
 return card(title,form);
}
const numKeys=(...keys)=>raw=>{for(const key of keys)if(raw[key]!==undefined)raw[key]=Number(raw[key]);return raw};
const choice=(label,name,rows,selected='')=>[label,name,'select',{options:rows,selected}];
const askInline=(title,action)=>{
 const root=el('div',{cls:'notice'},[node('p',title)]);
 const controls=el('div',{cls:'actions'},[btn('Onayla',async()=>{try{await action();root.remove()}catch(e){fail(e)}},true),btn('Vazgeç',()=>root.remove())]);
 root.append(controls);view().prepend(root);
};
async function hotels(){
 const data=await api('/api/backoffice/hotels'),items=data.items||[];
 const list=el('div');
 for(const h of items)list.append(el('div',{cls:'room'},[node('h3',h.name),node('p',h.location+' · '+(statusTR[h.status]||h.status)),btn('Otel yönetimi',()=>hotelDetail(h.id))]));
 view().append(card('Oteller',list));
 if(session.user?.role==='system_admin'){
  const agencies=(await api('/api/admin/agencies')).items.filter(a=>a.type==='master');
  view().append(editor('Yeni otel','/api/admin/hotels','POST',[
   ['Otel adı','name'],['Konum','location'],choice('Sahip ana acente','ownerAgencyId',agencies.map(a=>[a.id,a.name]))
  ],()=>go('hotels')));
 }
}
async function hotelDetail(id){
 const h=await api('/api/admin/hotels/'+encodeURIComponent(id));
 clear();
 view().append(btn('Otellere dön',()=>go('hotels')));
 view().append(editor('Otel bilgilerini düzenle','/api/admin/hotels/'+id,'PATCH',[
  ['Otel adı','name','text',h.name],['Konum','location','text',h.location],
  choice('Durum','status',[['draft','Taslak'],['active','Aktif'],['inactive','Pasif']],h.status)
 ],()=>hotelDetail(id)));
 const rooms=h.rooms||[],plans=h.ratePlans||[],publications=h.publications||[];
 for(const room of rooms){
  const section=el('div',{cls:'room'},[node('h3',room.name+' · '+room.max_adults+' yetişkin / '+room.max_children+' çocuk')]);
  section.append(btn('Odayı düzenle',()=>{clear();view().append(editor('Oda düzenle','/api/admin/rooms/'+room.id,'PATCH',[
   ['Oda adı','name','text',room.name],['Yetişkin kapasitesi','maxAdults','number',room.max_adults],
   ['Çocuk kapasitesi','maxChildren','number',room.max_children]
  ],()=>hotelDetail(id),numKeys('maxAdults','maxChildren')))},false));
  section.append(btn('Fiyat planı ekle',()=>ratePlanCreate(id,room),false));
  for(const plan of plans.filter(x=>x.room_id===room.id))section.append(el('div',{cls:'room'},[
   node('p',plan.board_name+' · '+plan.currency),
   ...(!termsValid(plan.cancellation_policy,plan.payment_terms)?[node('p','Koşullar eksik – yayınlanamaz')]:[]),
   btn('Takvim',()=>rateCalendar(id,plan)),btn('Yayınlar',()=>publicationEditor(id,plan,publications)),btn('Fiyat planını düzenle',()=>ratePlanEdit(id,plan))
  ]));
  view().append(card('Oda',section));
 }
 view().append(editor('Yeni oda','/api/admin/hotels/'+id+'/rooms','POST',[
  ['Oda adı','name'],['Açıklama','description'],['Yetişkin kapasitesi','maxAdults','number',2],['Çocuk kapasitesi','maxChildren','number',0]
 ],()=>hotelDetail(id),numKeys('maxAdults','maxChildren')));
 const contracts=await api('/api/admin/hotels/'+id+'/contracts');
 view().append(card('Kontratlar',el('div',{},(contracts.items||[]).map(x=>el('div',{cls:'room'},[
  node('p',x.name||x.code),btn('Kontrat yönetimi',()=>contractDetail(x.id))
 ])))));
 view().append(editor('Yeni kontrat','/api/admin/hotels/'+id+'/contracts','POST',[
  ['Kod','code'],['Ad','name'],['Para birimi','currency','text','EUR'],['Satıcı tüzel kişi','sellerLegalName']
 ],()=>hotelDetail(id)));
}
function termsValid(c,p){
 return !!c&&Number.isInteger(c.freeUntilDays)&&c.freeUntilDays>=0&&c.freeUntilDays<=365&&
 ['nights','percent'].includes(c.penaltyType)&&Number.isInteger(c.penaltyValue)&&c.penaltyValue>=1&&c.penaltyValue<=(c.penaltyType==='nights'?30:100)&&
 ['nights','percent'].includes(c.noShowPenaltyType)&&Number.isInteger(c.noShowPenaltyValue)&&c.noShowPenaltyValue>=1&&c.noShowPenaltyValue<=(c.noShowPenaltyType==='nights'?30:100)&&
 !!p&&Number.isInteger(p.dueDaysBeforeCheckIn)&&p.dueDaysBeforeCheckIn>=0&&p.dueDaysBeforeCheckIn<=365;
}
function termsText(c,p){
 if(!termsValid(c,p))return 'Koşullar eksik – yayınlanamaz';
 const penalty=(type,value)=>type==='nights'?value+' gece': '%'+value;
 return 'Girişe '+c.freeUntilDays+' gün kalana kadar ücretsiz iptal, sonrasında '+penalty(c.penaltyType,c.penaltyValue)+' ceza. No-show: '+penalty(c.noShowPenaltyType,c.noShowPenaltyValue)+'. Ödeme: girişten '+p.dueDaysBeforeCheckIn+' gün önce.';
}
function termsFields(c={},p={}){
 return [
 ['Ücretsiz iptal günü','freeUntilDays','number',c.freeUntilDays??7],
 choice('İptal cezası türü','penaltyType',[['nights','Gece'],['percent','Yüzde']],c.penaltyType||'nights'),
 ['İptal cezası değeri','penaltyValue','number',c.penaltyValue??1],
 choice('No-show cezası türü','noShowPenaltyType',[['nights','Gece'],['percent','Yüzde']],c.noShowPenaltyType||'percent'),
 ['No-show cezası değeri','noShowPenaltyValue','number',c.noShowPenaltyValue??100],
 ['Ödeme vadesi (girişten kaç gün önce)','dueDaysBeforeCheckIn','number',p.dueDaysBeforeCheckIn??14]
 ];
}
function termsBody(raw){
 const {freeUntilDays,penaltyType,penaltyValue,noShowPenaltyType,noShowPenaltyValue,dueDaysBeforeCheckIn,...rest}=raw;
 return {...rest,cancellationPolicy:{freeUntilDays:Number(freeUntilDays),penaltyType,penaltyValue:Number(penaltyValue),noShowPenaltyType,noShowPenaltyValue:Number(noShowPenaltyValue)},paymentTerms:{dueDaysBeforeCheckIn:Number(dueDaysBeforeCheckIn)}};
}
async function ratePlanCreate(hotelId,room){
 clear();view().append(btn('Otele dön',()=>hotelDetail(hotelId)));
 const contracts=(await api('/api/admin/hotels/'+hotelId+'/contracts')).items||[];
 view().append(editor('Yeni fiyat planı · '+room.name,'/api/admin/rooms/'+room.id+'/rate-plans','POST',[
  ['Pansiyon','boardName'],['Para birimi','currency','text','EUR'],
  choice('Kontrat','contractId',contracts.map(x=>[x.id,x.name||x.code])),
  ...termsFields()
 ],()=>hotelDetail(hotelId),raw=>({...termsBody(raw),salesConditions:{}})));
}
async function ratePlanEdit(hotelId,plan){
 clear();view().append(btn('Otele dön',()=>hotelDetail(hotelId)));
 view().append(editor('Fiyat planı düzenle','/api/admin/rate-plans/'+plan.id,'PATCH',[
  choice('Aktif','active',[['true','Evet'],['false','Hayır']],String(plan.active)),
  ...termsFields(plan.cancellation_policy,plan.payment_terms)
 ],()=>hotelDetail(hotelId),raw=>({...termsBody(raw),active:raw.active==='true'})));
}
async function rateCalendar(hotelId,plan){
 clear();view().append(btn('Otele dön',()=>hotelDetail(hotelId)));
 const dateFrom=plus(today(),1),dateTo=plus(today(),30);
 const data=await api('/api/admin/rate-plans/'+plan.id+'/calendar?dateFrom='+dateFrom+'&dateTo='+dateTo);
 view().append(card('Mevcut fiyat ve kontenjan · '+plan.board_name,node('pre',JSON.stringify(data.items||data,null,2))));
 view().append(editor('Tarih aralığı güncelle','/api/admin/rate-plans/'+plan.id+'/calendar','PUT',[
  ['Başlangıç','dateFrom','date',dateFrom],['Bitiş (dahil)','dateTo','date',dateTo],
  ['Gecelik net fiyat','price','number',0],['Kontenjan','allotment','number',0]
 ],()=>rateCalendar(hotelId,plan),numKeys('price','allotment')));
}
async function publicationEditor(hotelId,plan,publications){
 clear();view().append(btn('Otele dön',()=>hotelDetail(hotelId)));
 for(const pub of publications.filter(x=>x.rate_plan_id===plan.id)){
  view().append(card(pub.agency_name,el('div',{},[
   node('p',(pub.active?'Aktif':'Pasif')+' · '+pub.markup_type+' '+pub.markup_value),
   btn(pub.active?'Yayını kapat':'Yayını aç',()=>askInline('Yayın durumu değiştirilsin mi?',async()=>{
    await api('/api/admin/publications/'+pub.id,{method:'PATCH',body:{active:!pub.active}});
    await hotelDetail(hotelId);
   }))
  ])));
 }
 const agencies=(await api('/api/admin/publication-agencies')).items;
 view().append(editor('Acenteye yayınla','/api/admin/publications','POST',[
  choice('Acente','agencyId',agencies.map(x=>[x.id,x.name])),
  choice('Markup türü','markupType',[['percent','Yüzde'],['fixed','Sabit']]),
  ['Markup değeri','markupValue','number',0]
 ],()=>hotelDetail(hotelId),raw=>({...raw,ratePlanId:plan.id,markupValue:Number(raw.markupValue)})));
}
async function contractDetail(id){
 const data=await api('/api/admin/contracts/'+id);clear();
 view().append(card('Kontrat detayı',node('pre',JSON.stringify(data,null,2))));
 for(const rule of data.nationalityRules||[])view().append(card('Milliyet kuralı',el('div',{},[node('p',(rule.rule_type||rule.ruleType)+' · '+(rule.country_code||rule.countryCode||rule.market_group_id||rule.marketGroupId||'')),btn('Kuralı sil',()=>askInline('Milliyet kuralı silinsin mi?',async()=>{await api('/api/admin/nationality-rules/'+rule.id,{method:'DELETE'});await contractDetail(id)}))])));
 view().append(editor('Kontrat düzenle','/api/admin/contracts/'+id,'PATCH',[
  ['Ad','name','text',data.name],['Satıcı tüzel kişi','sellerLegalName','text',data.seller_legal_name],
  choice('Durum','status',[['active','Aktif'],['inactive','Pasif'],['draft','Taslak']],data.status)
 ],()=>contractDetail(id)));
 const groups=(await api('/api/admin/market-groups')).items||[];
 view().append(editor('Milliyet kuralı ekle','/api/admin/contracts/'+id+'/nationality-rules','POST',[
  choice('Kural','ruleType',[['include','Dahil et'],['exclude','Hariç tut']]),
  ['Ülke kodu (ISO 2)','countryCode']
 ],()=>contractDetail(id),raw=>({...raw,countryCode:raw.countryCode.toUpperCase()})));
 view().append(editor('Pazar grubu kuralı ekle','/api/admin/contracts/'+id+'/nationality-rules','POST',[
  choice('Kural','ruleType',[['include','Dahil et'],['exclude','Hariç tut']]),
  choice('Pazar grubu','marketGroupId',groups.map(x=>[x.id,x.name]))
 ],()=>contractDetail(id)));
}
async function markets(){
 const data=await api('/api/admin/market-groups');
 for(const x of data.items||[]){
  view().append(editor(x.name+' · ülkeleri düzenle','/api/admin/market-groups/'+x.id+'/countries','PUT',[
   ['Ülke kodları (virgülle)','countries','text',(x.countries||[]).join(',')]
  ],()=>go('markets'),raw=>({countries:raw.countries.split(',').map(s=>s.trim().toUpperCase()).filter(Boolean)})));
 }
 view().append(editor('Yeni pazar grubu','/api/admin/market-groups','POST',[
  ['Kod','code'],['Ad','name'],['Ülke kodları (virgülle)','countries']
 ],()=>go('markets'),raw=>({...raw,countries:raw.countries.split(',').map(s=>s.trim().toUpperCase()).filter(Boolean)})));
}
async function currencies(){
 const [cs,fx]=await Promise.all([api('/api/admin/currencies'),api('/api/admin/fx-rates')]);
 const currencyRows=cs.items||[];
 for(const x of currencyRows)view().append(card(x.code+' · '+x.name,el('div',{},[
  node('p',x.active?'Aktif':'Pasif'),btn(x.active?'Pasifleştir':'Etkinleştir',()=>askInline('Para birimi durumu değiştirilsin mi?',async()=>{
   await api('/api/admin/currencies/'+x.code,{method:'PATCH',body:{active:!x.active}});await go('currencies');
  }))
 ])));
 view().append(card('Güncel kurlar',el('div',{},(fx.items||[]).map(x=>node('p',x.currency+' · EUR/birim '+x.eur_per_unit+' · '+x.source)))));
 view().append(editor('Kur gir','/api/admin/fx-rates','POST',[
  choice('Para birimi','currency',currencyRows.filter(x=>x.code!=='EUR').map(x=>[x.code,x.code])),
  ['EUR / birim','eurPerUnit','number',1],['Kaynak','source']
 ],()=>go('currencies'),raw=>({source:raw.source,rates:[{currency:raw.currency,eurPerUnit:Number(raw.eurPerUnit)}]})));
}
async function agencies(){
  if(session.user?.role!=='system_admin'){
    view().append(card('Yetki gerekli',node('p','Acente ve kullanıcı yönetimi sistem yöneticisine özeldir.')));
    return;
  }
  const [agenciesData,usersData]=await Promise.all([api('/api/admin/agencies'),api('/api/admin/users')]);
  const agencyRows=agenciesData.items||[],userRows=usersData.items||[];
  const agencyNames=new Map(agencyRows.map(a=>[a.id,a.name]));
  const agencyList=el('div',{cls:'scroll'}),agencyTable=el('table',{cls:'list'});
  const agencyHead=el('tr');
  for(const x of ['Acente','Tür','Durum','İşlem'])agencyHead.append(node('th',x));
  agencyTable.append(agencyHead);
  for(const a of agencyRows){
    const tr=el('tr');
    for(const x of [a.name,a.type,a.active?'Aktif':'Pasif'])tr.append(node('td',x));
    tr.append(el('td',{},[btn('Düzenle',()=>{clear();view().append(editor('Acente düzenle','/api/admin/agencies/'+a.id,'PATCH',[
      choice('Aktif','active',[['true','Evet'],['false','Hayır']],String(a.active))
    ],()=>go('agencies'),raw=>({...raw,active:raw.active==='true'}))) }),btn(a.active?'Pasifleştir':'Etkinleştir',async()=>{
      try{await api('/api/admin/agencies/'+encodeURIComponent(a.id),{method:'PATCH',body:{active:!a.active}});await go('agencies')}catch(e){fail(e)}
    })]));
    agencyTable.append(tr);
  }
  agencyList.append(agencyTable);
  view().append(card('Acenteler ('+agencyRows.length+')',agencyRows.length?agencyList:node('p','Henüz acente bulunmuyor.')));
  const userList=el('div',{cls:'scroll'}),userTable=el('table',{cls:'list'}),userHead=el('tr');
  for(const x of ['E-posta','Rol','Acente','Durum','İşlem'])userHead.append(node('th',x));
  userTable.append(userHead);
  for(const u of userRows){
    const tr=el('tr');
    for(const x of [u.email,roleNames[u.role]||u.role,agencyNames.get(u.agency_id)||'Platform',u.active?'Aktif':'Pasif'])tr.append(node('td',x));
    tr.append(el('td',{},[btn('Düzenle',()=>{clear();view().append(editor('Kullanıcı düzenle','/api/admin/users/'+u.id,'PATCH',[
      choice('Aktif','active',[['true','Evet'],['false','Hayır']],String(u.active))
    ],()=>go('agencies'),raw=>({active:raw.active==='true'})));})]));
    userTable.append(tr);
  }
  userList.append(userTable);
  view().append(card('Kullanıcılar ('+userRows.length+')',userRows.length?userList:node('p','Henüz kullanıcı bulunmuyor.')));
  const agencyForm=el('form',{},[
    field('Acente adı','name'),
    el('label',{},[node('span','Acente türü'),el('select',{name:'type'},[
      el('option',{value:'master',text:'Ana acente'}),el('option',{value:'sub',text:'Alt acente'})
    ])]),
    el('button',{text:'Acente oluştur',cls:'primary',type:'submit'})
  ]);
  agencyForm.onsubmit=async e=>{
    e.preventDefault();
    try{await api('/api/admin/agencies',{method:'POST',body:Object.fromEntries(new FormData(agencyForm))});await go('agencies')}catch(err){fail(err)}
  };
  view().append(card('Yeni acente',agencyForm));
  const userForm=el('form',{},[
    field('E-posta','email','email'),field('Şifre (en az 12 karakter)','password','password'),
    el('label',{},[node('span','Rol'),el('select',{name:'role'},[
      ...['system_admin','back_office','master_agency','sub_agency'].map(role=>el('option',{value:role,text:roleNames[role]}))
    ])]),
    el('label',{},[node('span','Acente'),el('select',{name:'agencyId'},[
      el('option',{value:'',text:'Platform / acente yok'}),
      ...agencyRows.map(a=>el('option',{value:a.id,text:a.name+' ('+a.type+')'}))
    ])]),
    el('button',{text:'Kullanıcı oluştur',cls:'primary',type:'submit'})
  ]);
  userForm.onsubmit=async e=>{
    e.preventDefault();
    const body=Object.fromEntries(new FormData(userForm));
    if(['system_admin','back_office'].includes(body.role))delete body.agencyId;
    else if(!body.agencyId)return message('Bu rol için acente seçin.');
    try{await api('/api/admin/users',{method:'POST',body});await go('agencies')}catch(err){fail(err)}
  };
  view().append(card('Yeni kullanıcı',userForm));
}

function adminForm(url,method,fields,done){const form=el('form');for(const [label,name] of fields)form.append(field(label,name,name==='password'?'password':'text'));form.append(el('button',{text:'Kaydet',cls:'primary',type:'submit'}));form.onsubmit=async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(form));for(const k of Object.keys(body))if(body[k]==='')delete body[k];try{await api(url,{method,body});message('Kaydedildi.');done()}catch(e){fail(e)}};return form}
setAuth(false);
