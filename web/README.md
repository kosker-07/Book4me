# BED4BOOK — Bağımsız statik arayüz

Bu dalda yalnızca `web/` altında saf HTML, CSS ve tarayıcı ES modülleri bulunur. Framework, derleme, npm paketi, CDN, dış font/görsel ve OTP yoktur. `prototypes/` kullanılmamıştır.

## Çalıştırma

Depo kökünden:

```bash
python3 -m http.server 8080 --directory web
```

Tarayıcıda `http://localhost:8080` adresini açın. Başka bir statik HTTP sunucusu da kullanılabilir. `file://` yerine HTTP kullanın (ES modülleri tarayıcıda dosya protokolü kısıtlarına tabidir).

## API yapılandırması

Tek ayar: `web/config.js` içindeki `window.BED4BOOK_API_URL`. Varsayılan `http://localhost:3000`. Backend başka origin'de çalışıyorsa sunucu tarafında CORS izinleri gerekebilir; bu dal backend'i değiştirmez. Kimlik bilgileri ve token config dosyasına konmaz.

## Kullanım

- Alt acente: giriş, otel arama, teklif, taslak/rezervasyon, kendi rezervasyonları, detay, iptal, voucher.
- Back Office / sistem yöneticisi: tüm rezervasyonlar, onay/ret/iptal, voucher, otel/oda/fiyat planı/takvim/yayın yönetimi. Acente/kullanıcı oluşturma ve pasifleştirme uçları yalnız sistem yöneticisine açıktır.
- Ana acente: kendi otelleri ve rezervasyonları, onay/ret, ürün yönetimi; iptal düğmesi gösterilmez.

Backend fiyat, stok, kazanan teklif, yetki ve geçişlerin tek kaynağıdır. Yeni rezervasyon için `crypto.randomUUID()` ile idempotency anahtarı üretilir; belirsiz ağ hatasında aynı istek ve anahtarla yeniden deneme yapılabilir. Fiyat/quote/stok hatalarında başka teklif otomatik denenmez.

## Backend için öneriler (bu dalda uygulanmadı)

1. Farklı origin'li statik arayüz için gerekiyorsa kontrollü CORS desteği.
2. Alt acentede çoklu oda için oda bazlı misafir dağılımı ve kapasite doğrulama sözleşmesi.
3. Pazar/uyruk bazlı satış uygunluk filtresi.
4. Yönetim için acente/kullanıcı listeleme uçları; mevcut yönetim API'sinde oluşturma ve durum değiştirme var, listeleme yok. Şimdilik UUID ile işlem yapılır.
5. Herhangi bir e-posta kodu/OTP akışı istenmedi; mevcut login endpoint'i olduğu gibi kullanılır.

## Test durumu

Bu teslimde testlerin başarılı olduğu iddia edilmez. Entegrasyon, rol/yetki, gerçek PostgreSQL ve tarayıcı testleri Claude tarafından yapılacaktır.
