# BED4BOOK v2 — bağımsız arayüz

Bu sürüm yalnızca `feature/arayuz-v2` dalındadır. `/app` altında aynı origin üzerinden çalışır. `/giris`, `/demo`, eski `src/` ve backend iş kuralları korunur.

## Dosyalar
- `index.html`: erişilebilir sayfa kabuğu, giriş ve navigasyon
- `styles.css`: mobil öncelikli koyu/kırmızı tema
- `app.js`: rol bazlı ekranlar, gerçek API üzerinden arama/rezervasyon/işlemler
- `service.js`: bellekte bearer token, hata çevirisi, PDF indirme
- `assets/logo.svg`: beyaz/kırmızı BED4BOOK yazı logosu

## Ekran → API
- Giriş/çıkış/hesabım: `POST /api/auth/login`, `GET /api/me`, `POST /api/auth/logout`, `POST /api/auth/change-password`
- Acente arama: `POST /api/agency/searches`
- Acente rezervasyon oluşturma: `POST /api/agency/bookings` (`Idempotency-Key`)
- Acente rezervasyonlarım: `GET /api/agency/bookings`, `GET /api/agency/bookings/:id`, `POST /api/agency/bookings/:id/submit`, `POST /api/agency/bookings/:id/cancel`
- Acente voucher/proforma: `GET /api/agency/bookings/:id/voucher`, `GET /api/agency/bookings/:id/proforma`
- Yönetim paneli/rezervasyonlar: `GET /api/backoffice/bookings`, `GET /api/backoffice/bookings/:id`, `PATCH /api/backoffice/bookings/:id/status`, voucher/proforma GET, `POST /api/backoffice/bookings/:id/proforma/reissue`
- Oteller: `GET /api/backoffice/hotels`, `GET /api/admin/hotels/:id`, `POST /api/admin/hotels`, `GET /api/admin/hotels/:id/contracts`, `GET /api/admin/contracts/:id`, `POST /api/admin/hotels/:id/contracts`
- Pazarlar: `GET /api/admin/market-groups`
- Para birimleri/kurlar: `GET /api/admin/currencies`, `GET /api/admin/fx-rates`
- Acente ve kullanıcı oluşturma: `POST /api/admin/agencies`, `POST /api/admin/users`

## Yakında / sınırlar
Transfer, Tur, Uçak, Cari/Bakiye, Muhasebe, Raporlar, Rebooking, Entegrasyonlar/H2H, Platform markası. Yönetimde otel oda/fiyat planı/takvim/yayın/milliyet kuralı işlemlerinin tam form akışı, acente/kullanıcı listeleme ve düzenleme henüz tamamlanmadı. Mevcut API olmadan sahte kayıt gösterilmez.

## Backend için öneriler
1. **Kritik:** Arama/quote/booking oda bazında kişi dağılımı almalı; mevcut toplam kişi sayısı yaklaşımı farklı oda kapasitelerini yanlış eşleştirebilir. Mevcut UI toplam kişi gönderir ve kullanıcıyı uyarır.
2. Lokasyon/otel adı araması sunucu tarafında desteklenmeli; mevcut arayüz sonuçları tarayıcıda filtreler.
3. Acenteye izinli para birimi listeleme API'si eklenmeli; `GET /api/admin/currencies` yalnızca yönetim rolüne açık. Arayüz ödeme para birimi seçimini gizler ve backend varsayılanını kullanır.
4. Acente/kullanıcı listesi için yetki kapsamlı GET endpoint'leri; otel oda/kontrat/fiyat planı/takvim/yayın ve milliyet kuralı ekranlarını tamamlamak için daha zengin GET API'leri.
5. Kur/ödeme ve fiyat değişimi için entegrasyon testleri; tedarikçi rezervasyon onayı üretim sözleşmesiyle doğrulanmalı.

## Test / dağıtım
`npm run test:server` mevcut backend regresyon paketidir. Bu arayüz staging'e deploy edilmemiştir. İnceleme ve dağıtım Claude tarafından yapılmalıdır.
