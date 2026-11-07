/* Faz 1: Kontrat Operasyon Merkezi — mevcut okuyucuyu ve fiyat motorunu değiştirmeyen ek arayüz. */
const UI=B4M.ui, S=UI.S, A=UI.A, VP=B4M.vProd, Ux=B4M.util;
const esc=x=>Ux.esc(String(x??"")), hotelList=()=>B4M.prod.myH(B4M.ctx.dmc)||[];
const tabs=[["overview","Genel Bakış"],["approval","Onay Merkezi"],["compare","Fiyat Karşılaştırma"],["allot","Kontenjan"],["market","Milliyet"],["fx","Döviz"],["proforma","Proforma"],["history","Versiyonlar"]];
const state=()=>S.contractOps||(S.contractOps={view:"overview",hotel:"",date:"",room:""});
const box=(title,body)=>UI.box(title,body), btn=(name,fn,arg)=>UI.btn(name,fn,arg,"g");
const status=()=>'<span class="chip" style="border-color:#d97706;color:#d97706">Doğrulama entegrasyonu bekliyor · Satış onayı verilmedi</span>';
const msg='<p class="mu">Bu ekran henüz sunucu doğrulama/yayın API’sine bağlı değil. Buradaki kayıtlar yalnızca mevcut arayüz verisini gösterir; otomatik onay veya satış aktivasyonu yapılmaz.</p>';
const fmt=(v,cur)=>v==null?"—":esc(v)+" "+esc(cur||"");
const header=()=>{const q=state(),H=hotelList(),h=H.find(x=>String(x.id)===q.hotel)||H[0];if(h)q.hotel=String(h.id);
return '<div class="row" style="align-items:center;justify-content:space-between"><h2 style="margin:0">Kontrat Operasyon Merkezi</h2>'+btn("Excel / PDF Yükle","coImport")+'</div>'+
'<p class="mu">Faz 1 · mevcut arayüze eklenen operasyon ekranları</p>'+status()+
'<div class="row" style="margin-top:12px"><label>Otel <select '+UI.c("coHotel")+'><option value="">Otel seçin</option>'+H.map(x=>'<option value="'+esc(x.id)+'" '+(String(x.id)===q.hotel?"selected":"")+'>'+esc(x.name)+'</option>').join("")+'</select></label></div>'+
UI.tabs(tabs,q.view,"coTab")};
const view=()=>{const q=state(),H=hotelList(),h=H.find(x=>String(x.id)===q.hotel)||H[0];let out=header();if(!h)return out+box("Henüz otel yok","<p>Otel listesi boş. Önce mevcut Excel/PDF okuyucusuyla kontrat içe aktarın.</p>");
const R=h.rooms||[],P=(h.seasons||[]).flatMap(s=>(s.periods||[]).map(p=>({s:s.name,...p})));
if(q.view==="overview")out+=box("Kontrat Özeti",'<div class="row">'+UI.card("Otel",esc(h.name),"Kayıtlı ürün")+UI.card("Oda Tipi",R.length,"Tanımlı")+UI.card("Sezon", (h.seasons||[]).length,"Tanımlı")+UI.card("Periyot",P.length,"Tanımlı")+'</div>'+msg+btn("Mevcut otel detayını aç","coOpenHotel",h.id));
if(q.view==="approval")out+=box("Agent Onay Kuyruğu",msg+'<p><b>Gerekli durumlar:</b> PENDING_VALIDATION → APPROVED / REVIEW_REQUIRED → PUBLISHED (yalnızca backend yayın kapıları geçilirse).</p><p><b>Kontroller:</b> otel, oda, sezon, fiyat, SPO, stop-sale, allotment, milliyet, kaynak hücre izi, mükerrer kayıt.</p><p class="bad">Agent kontrol sonucu ve kaynak hücre eşleşmesi bu eski veri modelinde saklanmıyor. Güvenli onay butonu bilinçli olarak kapalıdır.</p><button class="g" disabled>Onayla ve Satışa Aç (backend bekleniyor)</button>');
if(q.view==="compare")out+=box("Kaynak Excel ↔ Sistem Fiyatı",msg+UI.tbl(["Sezon / Periyot","Oda","Sistemdeki net fiyat","Excel kaynak hücresi","Eşleşme"],P.flatMap(p=>R.map(r=>{const v=(p.prices||{})[r.id]||{};return '<tr><td>'+esc(p.s)+" / "+esc(p.name)+'</td><td>'+esc(r.type)+'</td><td>'+fmt(v.price,h.cur)+'</td><td>Kaynak izi yok</td><td class="bad">Doğrulanmadı</td></tr>'})).slice(0,80)));
if(q.view==="allot")out+=box("Oda Bazlı Kontenjan",msg+'<p>Bu görünümde mevcut oda kartındaki <b>gecelik temel allotment</b> gösterilir. Günlük stok, satılan ve kalan değerler PostgreSQL inventory_daily bağlantısından sonra gösterilecektir.</p>'+UI.tbl(["Oda Tipi","Temel kontenjan/gece","Günlük kalan","Stop-sale günü"],R.map(r=>'<tr><td>'+esc(r.type)+'</td><td>'+esc(r.allot??"—")+'</td><td>API bekleniyor</td><td>'+esc((r.stop||[]).length)+'</td></tr>')));
if(q.view==="market")out+=box("Milliyet ve Pazar Kuralları",msg+'<p>Kontrat bazında dahil/hariç ülke ve pazar grupları ile tüm misafirlerin milliyet uygunluğu yeni sunucu modeliyle yönetilecektir.</p><p>Eski otel seviyesi pazar ayarı: <b>'+esc((h.mk||{}).mode||"all")+'</b>. Bu ayar yeni kontrat milliyet kurallarının yerine geçmez.</p>');
if(q.view==="fx")out+=box("Döviz ve TCMB",msg+'<p>Kontrat para birimi: <b>'+esc(h.cur)+'</b></p><p>TCMB yayın saati, son başarılı kontrol, geçmiş kur versiyonları ve yetkili manuel override ekranı backend FX servisine bağlanacak. Bu panelde tahmini kur gösterilmez.</p>');
if(q.view==="proforma")out+=box("Proforma",msg+'<p>Pending/Approved rezervasyonun değişmez fiyat snapshot’ından numaralı proforma hazırlanacak. Bu panelden henüz proforma düzenlenmez.</p>'+btn("Rezervasyonlara git","coBookings"));
if(q.view==="history")out+=box("Değişiklik ve Versiyon Geçmişi",msg+'<p>Kaynak dosya checksum, satır/hücre izi, kim/ne zaman değiştirdi, önceki ve yeni fiyat, agent karar sürümü ve yeniden doğrulama kayıtları için audit API gerekir.</p>');
return out;};
const original=VP.hotels;VP.hotels=()=>S.contractOpsOpen?view():original();
A.coOpen=()=>{S.contractOpsOpen=true;state();};
A.coClose=()=>{S.contractOpsOpen=false;};
A.coTab=k=>{state().view=k;};
A.coHotel=(a,el)=>{state().hotel=el.value;};
A.coImport=()=>{S.contractOpsOpen=false;A.hsImp();};
A.coOpenHotel=id=>{S.contractOpsOpen=false;A.hs(id);};
A.coBookings=()=>{S.contractOpsOpen=false;S.tab="b";};
const old=VP.hotels;VP.hotels=()=>{if(S.contractOpsOpen)return '<div style="margin-bottom:12px">'+btn("‹ Otellere Dön","coClose")+'</div>'+view();return '<div style="display:flex;justify-content:flex-end;margin-bottom:10px">'+UI.btn("Kontrat Operasyon Merkezi","coOpen",null,"b")+'</div>'+original();};
