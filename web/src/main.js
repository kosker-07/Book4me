import {createApi,ApiError,STATUS,money,canManage,canCancel,canApprove,canVoucher,buildBooking} from './api.js';

const root=document.querySelector('#app');
const api=createApi(()=>{user=null;activeQuote=null;pendingAttempt=null;render();notify('Oturum sona erdi, yeniden giriş yapın','error');});
let user=null,activeQuote=null,pendingAttempt=null,searchResults=[],searchInput=null,view='search',busy=false;
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n};
const add=(parent,...children)=>{parent.append(...children);return parent};
const clear=node=>node.replaceChildren();
const field=(name,label,type='text',required=true)=>{const wrap=el('label');wrap.textContent=label;const input=el('input');input.name=name;input.type=type;input.required=required;input.dataset.testid=({'email':'login-email','password':'login-password'}[name]||name);wrap.append(input);return wrap};
const selectField=(name,label,options)=>{const wrap=el('label');wrap.textContent=label;const select=el('select');select.name=name;select.dataset.testid=name;for(const [value,text] of options){const o=el('option',text);o.value=value;select.append(o)}wrap.append(select);return wrap};
const button=(label,id,handler,primary=false)=>{const b=el('button',label,primary?'primary':'');b.type='button';b.dataset.testid=id;b.onclick=handler;return b};
const formValues=form=>Object.fromEntries(new FormData(form));
const note=el('div');note.id='notice';note.dataset.testid='error-message';note.setAttribute('role','status');
function notify(message,type=''){note.textContent=message;note.className=type; }
function heading(title){const h=el('h2',title);return h;}
function panel(title){return add(el('section',undefined,'panel'),heading(title));}
const validationText=code=>({REQUIRED:'Bu alan zorunlu',REQUIRED_VALID_PHONE:'Geçerli bir telefon girin',REQUIRED_ISO_3166_ALPHA2:'2 harfli ülke kodu girin (ör. TR)'})[code]||'Geçersiz değer';
function errorFields(form,fields){
 for(const input of form.querySelectorAll('[aria-invalid]')){input.removeAttribute('aria-invalid');input.parentElement.querySelector('.field-error')?.remove()}
 const general=[];
 for(const [key,codes] of Object.entries(fields||{})){
  const name=key.startsWith('guest.')?key.slice(6):key;
  const input=Array.from(form.elements).find(x=>x.name===name);
  const errors=(Array.isArray(codes)?codes:[codes]).map(validationText);
  if(!input){general.push(key+': '+errors.join(', '));continue}
  input.setAttribute('aria-invalid','true');
  input.parentElement.append(el('small',errors.join(', '),'field-error'));
  if(!input.dataset.validationBound){
   const clearError=()=>{input.removeAttribute('aria-invalid');input.parentElement.querySelector('.field-error')?.remove()};
   input.addEventListener('input',clearError);input.addEventListener('change',clearError);
   input.dataset.validationBound='true';
  }
 }
 return general;
}
async function execute(fn,form){if(busy)return;busy=true;const btn=form?.querySelector('button[type=submit]');if(btn)btn.disabled=true;try{notify('İşlem yapılıyor…');const result=await fn();notify('İşlem tamamlandı','success');return result}catch(err){const unmatched=err instanceof ApiError&&err.code==='VALIDATION_FAILED'&&form?errorFields(form,err.fields):[];notify((err instanceof ApiError?err.message:'Bağlantı sorunu oluştu. Lütfen yeniden deneyin.')+(unmatched.length?' — '+unmatched.join('; '):''),'error');return null}finally{busy=false;if(btn)btn.disabled=false;}}
function render(){clear(root);const header=el('header');const brand=el('div');const logo=el('div',undefined,'brand');logo.append('bed',el('b','4'),'book',el('b','.com'));brand.append(logo,el('div','HOTEL WHOLESALE PLATFORM','tag'));header.append(brand);
 if(user){const bar=el('div',undefined,'row');bar.append(el('span',user.email+' · '+user.role,'muted'),button('Çıkış','logout',async()=>{try{await api.call('/api/auth/logout',{method:'POST'})}catch{}api.clear();user=null;activeQuote=null;pendingAttempt=null;render()}));header.append(bar)}
 root.append(header);const main=el('main',undefined,'container');root.append(main);if(!user){renderLogin(main)}else{const tabs=el('nav',undefined,'tabs');for(const [id,label] of [['search','Otel arama'],['bookings','Rezervasyonlar'],['admin','Ürün yönetimi']]){if(id==='search'&&user.role!=='sub_agency'||id==='admin'&&!canManage(user.role))continue;const b=button(label,'nav-'+id,()=>{view=id;render()});if(view===id)b.setAttribute('aria-current','page');tabs.append(b)}main.append(tabs);if(view==='search'&&user.role==='sub_agency')renderSearch(main);else if(view==='admin'&&canManage(user.role))renderAdmin(main);else renderBookings(main)}main.append(note)}
function renderLogin(main){const box=panel('Yetkili kullanıcı girişi');box.style.maxWidth='440px';const form=el('form');form.dataset.testid='login-form';const grid=el('div',undefined,'grid');grid.append(field('email','E-posta','email'),field('password','Şifre','password'));const submit=el('button','Giriş yap','primary');submit.type='submit';submit.dataset.testid='login-submit';form.append(grid,submit);form.onsubmit=async e=>{e.preventDefault();const v=formValues(form);await execute(async()=>{const r=await api.call('/api/auth/login',{method:'POST',body:{email:v.email,password:v.password}});api.setToken(r.token);const me=await api.call('/api/me');user={...r.user,role:me.role||r.user.role};view=user.role==='sub_agency'?'search':'bookings';render();return r},form)};box.append(form);main.append(box)}
function dateISO(offset=0){const d=new Date();d.setDate(d.getDate()+offset);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
function renderSearch(main){const box=panel('Otel arama');const catalog=button('Yayınlanan otelleri göster','agency-hotels',async()=>{const r=await execute(()=>api.call('/api/agency/hotels'));if(!r)return;const list=panel('Yayınlanan oteller');for(const h of r.items||[])list.append(el('p',[h.name,h.location].filter(Boolean).join(' · ')));main.append(list)});box.append(catalog);const form=el('form');form.dataset.testid='search-form';const grid=el('div',undefined,'grid');for(const [name,label,type] of [['checkIn','Giriş tarihi','date'],['checkOut','Çıkış tarihi','date'],['rooms','Oda sayısı','number'],['adults','Yetişkin sayısı','number'],['children','Çocuk sayısı','number'],['childAges','Çocuk yaşları (virgülle, örn. 4,8)','text']])grid.append(field(name,label,type,name!=='childAges'));form.append(grid);form.elements.checkIn.dataset.testid='search-checkin';form.elements.checkOut.dataset.testid='search-checkout';form.elements.rooms.dataset.testid='search-rooms';form.elements.adults.dataset.testid='search-adults';form.elements.children.dataset.testid='search-children';form.elements.checkIn.value=searchInput?.checkIn||dateISO(1);form.elements.checkOut.value=searchInput?.checkOut||dateISO(3);form.elements.rooms.value=searchInput?.rooms||1;form.elements.adults.value=searchInput?.adults||2;form.elements.children.value=searchInput?.children??0;form.elements.childAges.value=searchInput?.childAges?.join(',')||'';for(const name of ['rooms','adults','children']){form.elements[name].min=name==='children'?'0':'1';form.elements[name].max=name==='rooms'?'10':'100'}
 const agesArea=el('div',undefined,'grid');function ageFields(){clear(agesArea);const count=Math.min(20,Math.max(0,Number(form.elements.children.value)||0));for(let i=0;i<count;i++){const f=field('childAge'+i,'Çocuk '+(i+1)+' yaşı','number');f.querySelector('input').min='0';f.querySelector('input').max='17';f.querySelector('input').dataset.testid='search-child-age-'+(i+1);f.querySelector('input').value=searchInput?.childAges?.[i]??'0';agesArea.append(f)}}form.elements.children.oninput=ageFields;ageFields();form.elements.childAges.parentElement.classList.add('hidden');form.append(agesArea);const submit=el('button','Otelleri ara','primary');submit.type='submit';submit.dataset.testid='search-submit';form.append(submit);form.onsubmit=async e=>{e.preventDefault();const v=formValues(form),ages=Array.from(agesArea.querySelectorAll('input')).map(input=>Number(input.value));const data={checkIn:v.checkIn,checkOut:v.checkOut,rooms:Number(v.rooms),adults:Number(v.adults),children:Number(v.children),childAges:ages};if(data.children!==ages.length||ages.some(x=>!Number.isInteger(x)||x<0||x>17)){notify('Çocuk sayısı ve yaşlarını kontrol edin','error');return}searchInput=data;activeQuote=null;pendingAttempt=null;const r=await execute(()=>api.call('/api/agency/searches',{method:'POST',body:data}),form);if(r){searchResults=Array.isArray(r.results)?r.results:[];render();notify(searchResults.length+' uygun teklif bulundu','success')}};box.append(form,el('p','Teklifler 30 dakika geçerlidir.','muted'));main.append(box);
 const result=panel('Uygun teklifler');result.dataset.testid='search-results';if(!searchResults.length)result.append(el('p','Arama yaptıktan sonra uygun teklifler burada görünecek.'));for(const offer of searchResults){const card=el('article',undefined,'offer');card.dataset.testid='result-card';card.append(el('h3',offer.hotel?.name||'Otel'),el('p',[offer.hotel?.location,offer.room?.name,offer.board].filter(Boolean).join(' · ')),el('div',money(offer.total,offer.currency),'price'));card.append(policyBlock('İptal koşulları',offer.cancellationPolicy),policyBlock('Ödeme koşulları',offer.paymentTerms));for(const night of offer.nights||[])card.append(el('p',formatDate(night.date)+' · '+money(night.price,offer.currency),'muted'));card.append(button('Rezervasyon yap','book-button',()=>{activeQuote=offer;pendingAttempt=null;render()},true));result.append(card)}main.append(result);if(activeQuote)renderBookingForm(main)}
function formatDate(value){const s=String(value||'');const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);return m?m[3]+'.'+m[2]+'.'+m[1]:s}
function policyRows(value,depth=0){
 if(value==null||typeof value==='object'&&!Array.isArray(value)&&!Object.keys(value).length)return [];
 if(typeof value!=='object')return [String(value)];
 if(Array.isArray(value))return [value.map(v=>typeof v==='boolean'?(v?'Evet':'Hayır'):String(v)).join(', ')];
 const rows=[];
 for(const [key,v] of Object.entries(value)){
  const pad='  '.repeat(depth);
  if(v&&typeof v==='object'&&!Array.isArray(v)){rows.push(pad+key+':');rows.push(...policyRows(v,depth+1));continue}
  if(key==='freeUntilDays')rows.push(pad+'Ücretsiz iptal: girişten '+v+' gün öncesine kadar');
  else if(key==='penaltyPercent')rows.push(pad+'İptal cezası: %'+v);
  else if(key==='nonRefundable')rows.push(pad+'İade edilmez: '+(v?'Evet':'Hayır'));
  else if(key==='prepay')rows.push(pad+'Ön ödeme gerekli: '+(v?'Evet':'Hayır'));
  else if(key==='dueDays')rows.push(pad+'Son ödeme: girişten '+v+' gün önce');
  else rows.push(pad+key+': '+(Array.isArray(v)?v.map(x=>typeof x==='boolean'?(x?'Evet':'Hayır'):String(x)).join(', '):typeof v==='boolean'?(v?'Evet':'Hayır'):String(v)));
 }
 return rows;
}
function policy(p){return policyRows(p).join('\n')||'Belirtilmemiş'}
function policyBlock(title,value){const wrap=el('div',undefined,'policy-block');wrap.append(el('strong',title));for(const line of policyRows(value).length?policyRows(value):['Belirtilmemiş'])wrap.append(el('p',line,'policy-line'));return wrap}
function renderBookingForm(main){const box=panel('Rezervasyon bilgileri');box.dataset.testid='booking-panel';box.append(el('p',activeQuote.hotel?.name+' · '+money(activeQuote.total,activeQuote.currency)));const form=el('form');form.dataset.testid='booking-form';const grid=el('div',undefined,'grid');for(const [name,label,type] of [['firstName','Ad','text'],['lastName','Soyad','text'],['adults','Yetişkin sayısı','number'],['children','Çocuk sayısı','number'],['childAges','Çocuk yaşları (çocuk yoksa 0 yazın)','text'],['email','E-posta','email'],['phone','Telefon','tel'],['nationality','Uyruk (TR, DE gibi)','text'],['operationNote','Operasyon notu','text']])grid.append(field(name,label,type));form.append(grid);for(const input of grid.querySelectorAll('input'))input.dataset.testid='guest-'+input.name;form.elements.adults.value=searchInput.adults;form.elements.children.value=searchInput.children;form.elements.childAges.value=searchInput.childAges.length?searchInput.childAges.join(','):'0';form.elements.nationality.maxLength=2;form.elements.nationality.minLength=2;form.elements.nationality.pattern='[A-Za-z]{2}';form.elements.adults.min=1;form.elements.children.min=0;
 const row=el('div',undefined,'actions');let draftMode=false;const draftButton=button('Taslak kaydet','booking-draft',()=>{draftMode=true;form.requestSubmit()});const submit=el('button','Gönder','primary');submit.type='submit';submit.dataset.testid='booking-submit';row.append(draftButton,submit);form.append(row);
 form.onsubmit=async e=>{e.preventDefault();const v=formValues(form);const ages=v.childAges==='0'&&Number(v.children)===0?[]:v.childAges.split(',').map(x=>Number(x.trim()));if(ages.length!==Number(v.children)||ages.some(x=>!Number.isInteger(x)||x<0||x>17)){notify('Çocuk yaşlarını kontrol edin','error');return}const guest={...v,childAges:ages};const payload=buildBooking(activeQuote.quoteId,guest,v.operationNote,draftMode);draftMode=false;const attempt={key:crypto.randomUUID(),payload};pendingAttempt=attempt;await sendBooking(form)};
 const retry=button('Aynı işlemi yeniden dene','retry-booking',()=>sendBooking(form));retry.classList.add('hidden');form.append(retry);box.append(form);main.append(box)}
async function sendBooking(form){if(!pendingAttempt||busy)return;const retry=form.querySelector('[data-testid=retry-booking]');retry.classList.add('hidden');const attempt=pendingAttempt;const result=await execute(()=>api.call('/api/agency/bookings',{method:'POST',body:attempt.payload,headers:{'Idempotency-Key':attempt.key}}),form);if(result){pendingAttempt=null;activeQuote=null;searchResults=[];view='bookings';render();notify('Rezervasyon oluşturuldu: '+result.bookingNo,'success')}else{const msg=note.textContent;if(/Bağlantı sorunu/.test(msg))retry.classList.remove('hidden');else{pendingAttempt=null;if(/Fiyat değişti|müsait değil|süresi doldu/.test(msg)){activeQuote=null;searchResults=[];notify(msg+' — yeniden arama yapın','error')}}}}
async function voucher(path){try{const pdf=await api.call(path,{response:'blob'});const url=URL.createObjectURL(pdf);const a=el('a');a.href=url;a.download='BED4BOOK-voucher.pdf';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(err){notify(err instanceof ApiError?err.message:'Voucher indirilemedi','error')}}
function renderBookings(main){const box=panel('Rezervasyonlar');const filters=el('div',undefined,'grid');const statusFilter=selectField('statusFilter','Durum',[['','Tümü'],['draft','Taslak'],['pending','Beklemede'],['approved','Onaylandı'],['rejected','Reddedildi'],['cancelled','İptal edildi']]);const query=field('queryFilter','Rezervasyon no / misafir / otel','search',false);filters.append(statusFilter,query);box.append(filters);box.append(button('Listeyi yenile','refresh-bookings',()=>loadBookings(box)));const list=el('div');list.dataset.testid='booking-list';box.append(list);main.append(box);statusFilter.querySelector('select').onchange=()=>loadBookings(box);query.querySelector('input').oninput=()=>loadBookings(box);loadBookings(box)}
async function loadBookings(box){const list=box.querySelector('[data-testid=booking-list]');const path=user.role==='sub_agency'?'/api/agency/bookings':'/api/backoffice/bookings';let r;try{r=await api.call(path)}catch(err){notify(err instanceof ApiError?err.message:'Liste alınamadı','error');return}clear(list);const selected=box.querySelector('[name=statusFilter]')?.value||'';const search=box.querySelector('[name=queryFilter]')?.value?.trim().toLocaleLowerCase('tr')||'';const items=(r.items||[]).filter(item=>(!selected||item.status===selected)&&(!search||[item.booking_no,item.hotel_name,item.guest_first_name,item.guest_last_name].join(' ').toLocaleLowerCase('tr').includes(search)));for(const item of items){const card=el('article',undefined,'booking');card.dataset.testid='booking-row';card.append(el('strong',item.booking_no+' · '+(STATUS[item.status]||item.status)),el('p',[item.hotel_name,formatDate(item.check_in),formatDate(item.check_out),money(item.total,item.currency)].filter(Boolean).join(' · ')));const actions=el('div',undefined,'actions');actions.append(button('Detay','booking-detail',async()=>{const prefix=user.role==='sub_agency'?'/api/agency':'/api/backoffice';const r=await execute(()=>api.call(prefix+'/bookings/'+encodeURIComponent(item.id)));if(r){const details=el('section',undefined,'panel');details.append(el('p',[r.guest_first_name,r.guest_last_name,formatDate(r.check_in),formatDate(r.check_out),r.room_name,r.board_name].filter(Boolean).join(' · ')));details.append(el('h4','Gecelik fiyatlar'));for(const night of r.nights||[])details.append(el('p',formatDate(night.date)+' · '+money(night.sell_price,night.currency)));details.append(policyBlock('İptal koşulları',r.cancellationPolicy??r.cancellation_policy),policyBlock('Ödeme koşulları',r.paymentTerms??r.payment_terms));details.append(el('h4','Durum geçmişi'));for(const history of r.history||[])details.append(el('p',formatDate(history.created_at)+' · '+(STATUS[history.to_status]||history.to_status)+' · '+(history.note||'')));card.append(details)}}));if(user.role==='sub_agency'&&item.status==='draft')actions.append(button('Taslağı gönder','submit-draft',()=>changeBooking('/api/agency/bookings/'+encodeURIComponent(item.id)+'/submit','POST',undefined,box)));
 if(canApprove(user.role,item.status)){for(const [status,label] of [['approved','Onayla'],['rejected','Reddet']])actions.append(button(label,status==='approved'?'approve-button':'reject-button',()=>changeBooking('/api/backoffice/bookings/'+encodeURIComponent(item.id)+'/status','PATCH',{status,note:''},box)))}
 if(canCancel(user.role,item.status)){actions.append(button('İptal et','cancel-button',async()=>{if(!confirm('Rezervasyon iptal edilsin mi?'))return;const path=user.role==='sub_agency'?'/api/agency/bookings/'+encodeURIComponent(item.id)+'/cancel':'/api/backoffice/bookings/'+encodeURIComponent(item.id)+'/status';const method=user.role==='sub_agency'?'POST':'PATCH';await changeBooking(path,method,user.role==='sub_agency'?{note:'Acente iptali'}:{status:'cancelled',note:'Operasyon iptali'},box)}))}
 if(canVoucher(item.status))actions.append(button('Voucher PDF','voucher-button',()=>voucher((user.role==='sub_agency'?'/api/agency':'/api/backoffice')+'/bookings/'+encodeURIComponent(item.id)+'/voucher')));
 card.append(actions);list.append(card)}if(!items.length)list.append(el('p','Bu filtreye uygun rezervasyon yok.'))}
async function changeBooking(path,method,body,box){const r=await execute(()=>api.call(path,{method,body}));if(r)await loadBookings(box)}

// Admin selector enhancement. The original forms and API payloads remain unchanged.
async function initAdminSelectors(main){
 const forms=Object.fromEntries(Array.from(main.querySelectorAll('form[data-testid^="admin-"]')).map(f=>[f.dataset.testid.slice(6),f]));
 const state={hotels:[],detail:null,agencies:null,users:null,hotelId:'',roomId:'',ratePlanId:''};
 const headingPanel=panel('Otel / oda / fiyat planı seçimi');
 const first=main.querySelector('[data-testid="list-hotels"]')?.parentElement;
 if(first)first.before(headingPanel);else main.prepend(headingPanel);
 const makeSelect=(testid)=>{const s=el('select');s.dataset.testid=testid;return s};
 const hotelSelect=makeSelect('admin-hotel-select'),roomSelect=makeSelect('admin-room-select'),rateSelect=makeSelect('admin-rateplan-select');
 const controls=el('div',undefined,'grid');
 for(const [label,s] of [['Otel',hotelSelect],['Oda',roomSelect],['Fiyat planı',rateSelect]]){const wrap=el('label',label);wrap.append(s);controls.append(wrap)}
 headingPanel.append(controls);
 const calendarPanel=panel('Seçili fiyat planı takvimi'),calendarHost=el('div');
 calendarHost.dataset.testid='admin-calendar-table';calendarPanel.append(calendarHost);headingPanel.append(calendarPanel);
 const publicationPanel=panel('Seçili otelin yayınları'),publicationHost=el('div');
 publicationHost.dataset.testid='admin-publication-list';publicationPanel.append(publicationHost);headingPanel.append(publicationPanel);
 const idSelects=[];
 function options(select,items,placeholder,selected){
  const old=selected??select.value;clear(select);const blank=el('option',placeholder);blank.value='';select.append(blank);
  for(const item of items){const opt=el('option',item.label);opt.value=item.id;select.append(opt)}
  if(items.some(item=>item.id===old))select.value=old;
  else if(items.length)select.value=items[0].id;
 }
 function replaceUuid(form,name,kind){
  if(!form)return;
  const input=Array.from(form.elements).find(x=>x.name===name);
  if(!input)return;
  const wrapper=input.parentElement;
  const selector=makeSelect(kind==='agency'?'admin-agency-select':kind==='user'?'admin-user-select':kind==='room'?'admin-room-select':kind==='rate'?'admin-rateplan-select':'admin-hotel-select');
  selector.name=name;selector.required=input.required;
  const fallback=el('small','Liste henüz kullanılamıyor','muted');fallback.hidden=true;
  input.name='';input.required=false;input.hidden=true;
  wrapper.append(selector,fallback);
  idSelects.push({form,name,kind,input,selector,fallback});
 }
 for(const [id,form] of Object.entries(forms)){
  const kinds={hotel:{ownerAgencyId:'master'},room:{hotelId:'hotel'},rate:{roomId:'room'},calendar:{ratePlanId:'rate'},publication:{ratePlanId:'rate',agencyId:'sub'},activate:{hotelId:'hotel'},user:{agencyId:'userAgency'},'agency-status':{id:'agency'},'user-status':{id:'user'}};
  for(const [name,kind] of Object.entries(kinds[id]||{}))replaceUuid(form,name,kind);
 }
 function setFallback(binding,on){
  binding.selector.hidden=on;binding.selector.disabled=on;binding.selector.name=on?'':binding.name;
  binding.input.hidden=!on;binding.input.disabled=!on;binding.input.name=on?binding.name:'';binding.input.required=on&&binding.selector.required;
  binding.fallback.hidden=!on;
 }
 function fillBindings(){
  const rooms=state.detail?.rooms||[],rates=state.detail?.ratePlans||[];
  const opts={
   hotel:state.hotels.map(x=>({id:x.id,label:x.name+' · '+(x.location||'')})),
   room:rooms.map(x=>({id:x.id,label:x.name})),
   rate:rates.map(x=>({id:x.id,label:x.board_name+' · '+x.currency})),
   master:(state.agencies||[]).filter(x=>x.type==='master'&&x.active!==false).map(x=>({id:x.id,label:x.name})),
   sub:(state.agencies||[]).filter(x=>x.type==='sub'&&x.active!==false).map(x=>({id:x.id,label:x.name})),
   userAgency:(state.agencies||[]).map(x=>({id:x.id,label:x.name+' · '+x.type})),
   agency:(state.agencies||[]).map(x=>({id:x.id,label:x.name+(x.active?'':' (pasif)')})),
   user:(state.users||[]).map(x=>({id:x.id,label:x.email+' · '+x.role+(x.active?'':' (pasif)')}))
  };
  for(const b of idSelects){
   const unavailable=(['master','sub','userAgency','agency'].includes(b.kind)&&state.agencies===null)||(b.kind==='user'&&state.users===null);
   setFallback(b,unavailable);
   if(!unavailable)options(b.selector,opts[b.kind]||[],'Seçiniz',b.selector.value||({hotel:state.hotelId,room:state.roomId,rate:state.ratePlanId}[b.kind]||''));
  }
 }
 function showPublications(){
  clear(publicationHost);
  const rows=state.detail?.publications||[];
  if(!rows.length){publicationHost.append(el('p','Bu otelde yayın yok.'));return}
  const table=el('table');const head=el('tr');
  for(const title of ['Acente','Fiyat planı','Markup türü','Değer','Aktif'])head.append(el('th',title));
  table.append(head);
  for(const p of rows){const tr=el('tr');const plan=(state.detail.ratePlans||[]).find(r=>r.id===p.rate_plan_id);
   for(const value of [p.agency_name||p.agency_id,plan?.board_name||p.rate_plan_id,p.markup_type,p.markup_value,p.active?'Evet':'Hayır'])tr.append(el('td',value));table.append(tr)}
  publicationHost.append(table);
 }
 async function showCalendar(){
  clear(calendarHost);
  if(!state.ratePlanId){calendarHost.append(el('p','Fiyat planı seçiniz.'));return}
  try{
   const result=await api.call('/api/admin/rate-plans/'+encodeURIComponent(state.ratePlanId)+'/calendar');
   if(!result.items?.length){calendarHost.append(el('p','Takvimde kayıt yok.'));return}
   const table=el('table');const head=el('tr');
   for(const title of ['Tarih','Net fiyat','Kontenjan','Rezerve'])head.append(el('th',title));
   table.append(head);
   for(const item of result.items){const tr=el('tr');
    for(const value of [formatDate(item.date),String(item.price),String(item.allotment),String(item.reserved)])tr.append(el('td',value));
    table.append(tr)}
   calendarHost.append(table);
  }catch(err){calendarHost.append(el('p',err instanceof ApiError?err.message:'Takvim yüklenemedi'))}
 }
 function syncRate(){const rates=state.detail?.ratePlans||[];options(rateSelect,rates.map(r=>({id:r.id,label:r.board_name+' · '+r.currency})),'Fiyat planı seçiniz',state.ratePlanId);state.ratePlanId=rateSelect.value;fillBindings();showCalendar()}
 function syncRoom(){const rooms=state.detail?.rooms||[];options(roomSelect,rooms.map(r=>({id:r.id,label:r.name})),'Oda seçiniz',state.roomId);state.roomId=roomSelect.value;syncRate()}
 async function selectHotel(id){
  state.hotelId=id;state.detail=null;state.roomId='';state.ratePlanId='';
  if(id){try{state.detail=await api.call('/api/admin/hotels/'+encodeURIComponent(id))}catch(err){notify(err instanceof ApiError?err.message:'Otel detayı alınamadı','error')}}
  syncRoom();showPublications();
 }
 async function refreshHotels(selected){
  try{const r=await api.call('/api/backoffice/hotels');state.hotels=r.items||[];
   options(hotelSelect,state.hotels.map(h=>({id:h.id,label:h.name+' · '+(h.location||'')})),'Otel seçiniz',selected||state.hotelId);
   await selectHotel(hotelSelect.value);
  }catch(err){notify(err instanceof ApiError?err.message:'Otel listesi alınamadı','error')}
 }
 async function refreshAgencies(){
  try{const r=await api.call('/api/admin/agencies');state.agencies=r.items||[]}
  catch(err){state.agencies=null;if(!(err instanceof ApiError&&err.status===404))notify('Acente listesi alınamadı; elle UUID girebilirsiniz.','error')}
  fillBindings();
 }
 async function refreshUsers(){
  if(!forms['user-status'])return;
  try{const r=await api.call('/api/admin/users');state.users=r.items||[]}
  catch(err){state.users=null;if(!(err instanceof ApiError&&err.status===404))notify('Kullanıcı listesi alınamadı; elle UUID girebilirsiniz.','error')}
  fillBindings();
 }
 hotelSelect.onchange=()=>selectHotel(hotelSelect.value);
 roomSelect.onchange=()=>{state.roomId=roomSelect.value;fillBindings()};
 rateSelect.onchange=()=>{state.ratePlanId=rateSelect.value;fillBindings();showCalendar()};
 for(const b of idSelects){
  b.selector.onchange=()=>{if(b.kind==='hotel'){state.hotelId=b.selector.value;hotelSelect.value=state.hotelId;selectHotel(state.hotelId)}
   else if(b.kind==='room'){state.roomId=b.selector.value;roomSelect.value=state.roomId;fillBindings()}
   else if(b.kind==='rate'){state.ratePlanId=b.selector.value;rateSelect.value=state.ratePlanId;fillBindings();showCalendar()}};
 }
 for(const [id,form] of Object.entries(forms)){
  form.addEventListener('submit',async()=>{
   // Wait until the existing form handler has completed, then refresh the affected lists.
   // A successful save writes a non-empty result line; failed saves leave it unchanged.
   const result=form.querySelector('p.muted');const before=result?.textContent;
   await new Promise(resolve=>{const watch=new MutationObserver(()=>{if(result?.textContent!==before){watch.disconnect();resolve()}});if(result)watch.observe(result,{childList:true,characterData:true,subtree:true});setTimeout(()=>{watch.disconnect();resolve()},2500)});
   if(!result?.textContent?.startsWith('Kaydedildi')||result.textContent===before)return;
   const match=result.textContent.match(/ID: ([0-9a-f-]{36})/i);const createdId=match?.[1];
   if(id==='hotel')await refreshHotels(createdId);
   else if(['room','rate','activate','calendar','publication'].includes(id)){
    await selectHotel(state.hotelId);
    if(id==='room'&&createdId){state.roomId=createdId;syncRoom()}
    if(id==='rate'&&createdId){state.ratePlanId=createdId;syncRate()}
   }
   else if(['agency','agency-status'].includes(id)){await refreshAgencies();if(createdId){for(const b of idSelects.filter(x=>x.kind==='agency'||x.kind==='master'||x.kind==='sub'))if(Array.from(b.selector.options).some(o=>o.value===createdId))b.selector.value=createdId}}
   else if(['user','user-status'].includes(id)){await refreshUsers();if(createdId){for(const b of idSelects.filter(x=>x.kind==='user'))b.selector.value=createdId}}
  });
 }
 await refreshHotels();await refreshAgencies();await refreshUsers();
}

function renderAdmin(main){const notice=el('p','Ürün yönetimi yalnız yetkili kullanıcılar içindir.','notice');main.append(notice);const hotels=panel('Yetkili oteller');main.append(hotels);const hotelsButton=button('Otelleri listele','list-hotels',async()=>{const r=await execute(()=>api.call('/api/backoffice/hotels'));if(!r)return;for(const old of hotels.querySelectorAll('.hotel-row'))old.remove();for(const h of r.items||[]){const item=el('p',h.name+' · '+h.location+' · '+(STATUS[h.status]||h.status),'hotel-row');hotels.append(item)}});hotels.append(hotelsButton);
 const defs=[
 {title:'Otel oluştur',id:'hotel',path:'/api/admin/hotels',method:'POST',fields:[['name','Otel adı'],['location','Konum'],['ownerAgencyId','Ana acente UUID (platform yöneticisi)']] ,map:v=>({name:v.name,location:v.location,...(v.ownerAgencyId?{ownerAgencyId:v.ownerAgencyId}:{})})},
 {title:'Oda oluştur',id:'room',path:v=>'/api/admin/hotels/'+encodeURIComponent(v.hotelId)+'/rooms',method:'POST',fields:[['hotelId','Otel UUID'],['name','Oda adı'],['maxAdults','Maksimum yetişkin','number'],['maxChildren','Maksimum çocuk','number']],map:v=>({name:v.name,maxAdults:Number(v.maxAdults),maxChildren:Number(v.maxChildren)})},
 {title:'Fiyat planı oluştur',id:'rate',path:v=>'/api/admin/rooms/'+encodeURIComponent(v.roomId)+'/rate-plans',method:'POST',fields:[['roomId','Oda UUID'],['boardName','Pansiyon'],['currency','Para birimi']],map:v=>({boardName:v.boardName,currency:v.currency.toUpperCase(),cancellationPolicy:{},paymentTerms:{},salesConditions:{}})},
 {title:'Fiyat / kontenjan takvimi',id:'calendar',path:v=>'/api/admin/rate-plans/'+encodeURIComponent(v.ratePlanId)+'/calendar',method:'PUT',fields:[['ratePlanId','Fiyat planı UUID'],['dateFrom','Başlangıç','date'],['dateTo','Bitiş','date'],['price','Net gecelik fiyat','number'],['allotment','Kontenjan','number']],map:v=>({dateFrom:v.dateFrom,dateTo:v.dateTo,price:Number(v.price),allotment:Number(v.allotment)})},
 {title:'Acenteye ürün yayınla',id:'publication',path:'/api/admin/publications',method:'POST',fields:[['ratePlanId','Fiyat planı UUID'],['agencyId','Alt acente UUID'],['markupValue','Markup değeri','number']],extra:[['markupType','Markup türü',[['percent','Yüzde'],['fixed','Sabit']]]],map:v=>({ratePlanId:v.ratePlanId,agencyId:v.agencyId,markupType:v.markupType,markupValue:Number(v.markupValue)})},
 {title:'Oteli satışa aç',id:'activate',path:v=>'/api/admin/hotels/'+encodeURIComponent(v.hotelId),method:'PATCH',fields:[['hotelId','Otel UUID']],map:()=>({status:'active'})}
 ];
 if(user.role==='system_admin')defs.push(
 {title:'Acente oluştur',id:'agency',path:'/api/admin/agencies',method:'POST',fields:[['name','Acente adı']],extra:[['type','Acente türü',[['master','Ana acente'],['sub','Alt acente']]]],map:v=>({name:v.name,type:v.type})},
 {title:'Kullanıcı oluştur',id:'user',path:'/api/admin/users',method:'POST',fields:[['email','E-posta','email'],['password','Başlangıç şifresi','password'],['agencyId','Acente UUID']],extra:[['role','Rol',[['sub_agency','Alt acente'],['master_agency','Ana acente'],['back_office','Back Office'],['system_admin','Sistem yöneticisi']]]],map:v=>({email:v.email,password:v.password,agencyId:v.agencyId||null,role:v.role})});
 if(user.role==='system_admin')defs.push({title:'Acente aktif/pasif',id:'agency-status',path:v=>'/api/admin/agencies/'+encodeURIComponent(v.id),method:'PATCH',fields:[['id','Acente UUID']],extra:[['active','Durum',[['false','Pasifleştir'],['true','Aktifleştir']]]],map:v=>({active:v.active==='true'})},{title:'Kullanıcı aktif/pasif',id:'user-status',path:v=>'/api/admin/users/'+encodeURIComponent(v.id),method:'PATCH',fields:[['id','Kullanıcı UUID']],extra:[['active','Durum',[['false','Pasifleştir'],['true','Aktifleştir']]]],map:v=>({active:v.active==='true'})});for(const def of defs){const box=panel(def.title);const form=el('form');form.dataset.testid='admin-'+def.id;const grid=el('div',undefined,'grid');for(const [name,label,type] of def.fields)grid.append(field(name,label,type||'text',name!=='ownerAgencyId'&&name!=='agencyId'));for(const [name,label,options] of def.extra||[])grid.append(selectField(name,label,options));form.append(grid);const submit=el('button','Kaydet','primary');submit.type='submit';submit.dataset.testid='save-'+def.id;form.append(submit);const result=el('p',undefined,'muted');form.append(result);form.onsubmit=async e=>{e.preventDefault();const v=formValues(form);const r=await execute(()=>api.call(typeof def.path==='function'?def.path(v):def.path,{method:def.method,body:def.map(v)}),form);if(r)result.textContent='Kaydedildi · ID: '+(r.id||r.ratePlanId||'güncellendi')};box.append(form);main.append(box)}
 initAdminSelectors(main).catch(()=>notify('Yönetim listeleri yüklenemedi','error'));
}
render();
