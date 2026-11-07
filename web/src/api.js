// API origin is supplied only through VITE_API_URL; no production host is hard-coded.
export const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
export const STATUS = Object.freeze({draft:'Taslak',pending:'Beklemede',approved:'Onaylandı',rejected:'Reddedildi',cancelled:'İptal edildi'});
const messages = {
 INVALID_CREDENTIALS:'E-posta veya şifre hatalı', TOO_MANY_LOGIN_ATTEMPTS:'Çok fazla deneme, 15 dakika sonra tekrar deneyin',
 PRICE_CHANGED:'Fiyat değişti, lütfen yeniden arayın',ALLOTMENT_UNAVAILABLE:'Bu oda artık müsait değil, lütfen yeniden arayın',
 QUOTE_EXPIRED:'Teklifin süresi doldu, lütfen yeniden arayın',
 QUOTE_OCCUPANCY_MISMATCH:'Kişi sayısı teklifle uyuşmuyor, lütfen yeniden arayın',
 OCCUPANCY_EXCEEDS_CAPACITY:'Kişi sayısı oda kapasitesini aşıyor',
 IDEMPOTENCY_KEY_REUSED:'Bu işlem zaten farklı bilgilerle gönderildi',
 CANCEL_NOT_ALLOWED:'Bu işlem bu durumda yapılamaz',INVALID_STATUS_TRANSITION:'Bu işlem bu durumda yapılamaz',
 ONLY_DRAFT_CAN_BE_SUBMITTED:'Bu işlem bu durumda yapılamaz',
 VOUCHER_REQUIRES_APPROVED_BOOKING:'Voucher sadece onaylı rezervasyonda alınabilir',
 BOOKING_NOT_FOUND:'Kayıt bulunamadı',PRODUCT_NOT_PUBLISHED:'Kayıt bulunamadı',
 UNAUTHENTICATED:'Oturum sona erdi, yeniden giriş yapın',SESSION_REVOKED:'Oturum sona erdi, yeniden giriş yapın',
 VALIDATION_FAILED:'Bilgileri kontrol edin', FORBIDDEN:'Bu işlem için yetkiniz yok'
};
export function errorMessage(code,status){return messages[code] || (status===429?'Çok fazla deneme, lütfen bekleyin':status>=500?'Sunucuda bir hata oluştu, daha sonra tekrar deneyin':'İşlem tamamlanamadı');}
export function money(value,currency){const raw=String(value??'');if(!/^-?\d+(\.\d+)?$/.test(raw))return raw+' '+(currency||'');return new Intl.NumberFormat('tr-TR',{style:'currency',currency:/^[A-Z]{3}$/.test(currency||'')?currency:'EUR'}).format(Number(raw));}
export function canManage(role){return ['system_admin','back_office','master_agency'].includes(role);}
export function canCancel(role,status){return role==='sub_agency'&&['draft','pending'].includes(status)||['system_admin','back_office'].includes(role)&&['draft','pending','approved'].includes(status);}
export function canApprove(role,status){return canManage(role)&&status==='pending';}
export function canVoucher(status){return status==='approved';}
export function buildBooking(quoteId,guest,operationNote,draft=false){return {quoteId,guest:{firstName:guest.firstName,lastName:guest.lastName,adults:Number(guest.adults),children:Number(guest.children),childAges:guest.childAges,email:guest.email,phone:guest.phone,nationality:guest.nationality.toUpperCase()},operationNote,draft};}
export class ApiError extends Error{constructor(code,status,fields){super(errorMessage(code,status));this.name='ApiError';this.code=code;this.status=status;this.fields=fields||{};}}
export function createApi(onUnauthorized){
 let token='';
 return {
  setToken(value){token=value||'';},clear(){token='';},get hasToken(){return Boolean(token);},
  async call(path,{method='GET',body,headers={},response='json',signal}={}){
   const res=await fetch(API_URL+path,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal,cache:'no-store'});
   if(!res.ok){let payload={};try{payload=await res.json()}catch{}if(res.status===401&&['UNAUTHENTICATED','SESSION_REVOKED'].includes(payload.error)){token='';onUnauthorized?.();}
    throw new ApiError(payload.error||'',res.status,payload.fields);}
   if(response==='blob')return res.blob();if(res.status===204)return null;return res.json();
  }
 };
}
