# ChatGPT için düzeltme görevi — BED4BOOK v1 sunucu temeli (PR #2)

Merhaba ChatGPT. BED4BOOK projesinin `feature/bed4book-v1-server-foundation` dalındaki sunucu kodu (PR #2) Claude tarafından bağımsız olarak incelendi. Ayrıntılı rapor: `docs/reviews/CLAUDE_V1_TECHNICAL_REVIEW.md` (`claude/clever-thompson-awnwcc` dalında). Bulgular gerçek bir PostgreSQL 16 veri tabanında, API çalıştırılarak doğrulandı.

Senden bu bulguları **aşağıdaki sırayla** düzeltmeni istiyorum. Claude'un raporunu da otomatik olarak doğru kabul etme. Katılmadığın bir bulgu olursa gerekçesiyle belirt.

## Çalışma kuralları

1. Bağlayıcı kaynaklar: `docs/BED4BOOK_Teknik_Sartname.md`, `docs/BED4BOOK_Proje_Sartnamesi.md`, `docs/IMPLEMENTATION_PLAN_BED4BOOK_V1.md`.
2. Kapsam dışı: Supplier API/XML, ödeme/sanal POS, e-fatura, muhasebe, mobil uygulama, Rebooking/RateRelay.
3. **Önce test, sonra düzeltme:** Her bulgu için önce hatayı gösteren (kırmızı) bir test yaz, sonra düzelt ve testin geçtiğini göster.
4. Testler **gerçek PostgreSQL** ile çalışmalı (mock veri tabanı kabul edilmez).
5. Her adımda şunları teslim et: değişen dosyalar, çalıştırılacak komutlar, beklenen çıktı ve gerçek test çıktısı.
6. Main dalına doğrudan gönderme, PR'ı merge etme, mevcut tarayıcı uygulamasını silme.
7. Aşağıda **"KARAR GEREKLİ"** olarak işaretlenen konularda proje sahibinin onayı olmadan bir model seçme. Seçenekleri sun ve onay bekle.
8. Var olan migration'ı (`001_initial.sql`) değiştirme. Yeni değişiklikleri `002_...sql` gibi yeni migration dosyalarıyla yap.

---

## ADIM 1 — Test altyapısı (Y6) — önce bu yapılmalı

Şu an CI yeşil ama rezervasyon uç noktası tamamen bozuk; çünkü API/DB testi yok.

- `package-lock.json` oluştur ve commit et; CI'de `npm install` yerine `npm ci` kullan.
- `.gitignore` ekle: `node_modules/`, `dist-server/`, `.env*`.
- `.github/workflows/bed4book-v1-server.yml` içine `postgres:16` servisi ekle; testlerden önce migration'ları uygula.
- Entegrasyon test çatısı kur (ör. `node:test` + gerçek HTTP istekleri, her test için temiz veri tabanı).
- `push` tetikleyicisine `main` dalını da ekle.
- Başlangıç için `docs/reviews/probes/v1_api_probe.ts` betiğindeki senaryolar kullanılabilir; ancak betik olarak bırakmayıp gerçek test dosyalarına dönüştür.

**Kabul:** CI'de Postgres ile en az bir API testi koşuyor ve K1 için yazılan test başta **kırmızı**.

## ADIM 2 — K1: Rezervasyon oluşturma her zaman 500 dönüyor (Kritik)

- **Konum:** `server/app.ts:150`
- **Sorun:** Sorgu `$1` ve `$3` kullanıyor, `$2` (`date`) gönderiliyor ama kullanılmıyor. PostgreSQL hata veriyor: `42P18 could not determine data type of parameter $2`.
- **Düzeltme:**
  ```ts
  const upd = await client.query(
    "UPDATE inventory_daily SET reserved = reserved + $2 WHERE id = $1 AND allotment - reserved >= $2",
    [inventory.rows[0].id, rooms]);
  if (upd.rowCount !== 1) throw Object.assign(new Error("ALLOTMENT_UNAVAILABLE"), { status: 409 });
  ```
- **Test:** Aktif otel + oda + fiyat planı + 2 gecelik kontenjan + alt acenteye yayın → `POST /api/agency/bookings` 201 dönmeli, her gece için `reserved` 1 artmalı.

## ADIM 3 — KARAR GEREKLİ: Proje sahibine sorulacak konular

Kodlamaya geçmeden önce aşağıdaki seçenekleri proje sahibine sun ve onay al:

1. **Fiyatlandırma modeli (K3 için):**
   - A) `inventory_daily.price` net fiyattır; acenteye yüzde veya sabit kâr (markup) eklenir.
   - B) Her acenteye tarih aralıklı ayrı satış fiyatı tanımlanır.
2. **Durum ve iptal politikası (Y1 için):** Onaydan sonra iptali kim yapabilir? Alt acente kendi rezervasyonunu hangi durumlarda iptal edebilir?
3. **Back Office kapsamı (Y5 için):** Operasyon ekibi yalnızca kendi ana acentesinin otellerini mi görecek, yoksa tüm platformu mu?
4. **Misafir bilgileri (O6 için):** Yetişkin/çocuk sayısı, çocuk yaşları, telefon, uyruk, operasyon notu — hangileri zorunlu? (KVKK açısından en az veri ilkesi gözetilmeli.)

## ADIM 4 — Veri modeli düzeltmeleri (`002_...sql` migration)

- **K3 / K2:** Rezervasyonun gecelik dökümünü tutan tablo: `booking_nights(booking_id, inventory_daily_id, stay_date, rooms, net_price, sell_price)`.
- **Y1:** `bookings.status` CHECK kısıtına `draft` ekle.
- **Y5:** Rol ↔ acente tipi zorunluluğu: `master_agency` ve `back_office` yalnızca `type='master'` acentede, `sub_agency` yalnızca `type='sub'` acentede olabilir. `hotels.owner_agency_id` yalnızca ana acente olabilir.
- **Y3:** `agency_hotel_sales.hotel_id` fiyat planının oteliyle tutarsız olabiliyor. Bu sütunu kaldır ve oteli `rate_plan → room → hotel` üzerinden türet, ya da bileşik FK ile tutarlılığı zorla. Yayının hedef acentesi `type='sub'` olmalı.
- **O4:** `CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));`
- **O7:** `audit_logs` tablosuna `target_agency_id`, `before jsonb`, `after jsonb`, `ip inet`, `user_agent`, `request_id` ekle.
- **D2:** İndeksler: `bookings(hotel_id)`, `agency_hotel_sales(agency_id)`, `booking_status_history(booking_id)`; `updated_at` tetikleyicisi.

## ADIM 5 — K3: Fiyat hesabı (Kritik) — Adım 3'teki karar sonrası

- **Konum:** `server/app.ts:131-153`
- **Sorun:** Toplam `sell_price × oda × gece` ile hesaplanıyor; günlük fiyat (`inventory_daily.price`) ve fiyat planı para birimi yok sayılıyor. Doğrulanan örnek: günlük 100 + 200 EUR → rezervasyon toplamı `100 TRY`.
- **Düzeltme:** Onaylanan modele göre her gece için fiyatı hesapla, toplamı SQL `numeric` ile al, para birimini `rate_plans.currency` ile tutarlı tut, gecelik dökümü `booking_nights` tablosuna yaz.
- **Test:** 3 gece, günlük 100/200/300; acente A %10, acente B %20 kâr → A için 660, B için 720. A'nın yanıtında B'nin fiyatı yer almamalı.

## ADIM 6 — K2 + Y1: Kontenjan iadesi ve durum makinesi (Kritik/Yüksek)

- **Konum:** `server/app.ts:183-205`
- **Sorun:** Red/iptalde `inventory_daily.reserved` geri azaltılmıyor. Onaylanmış rezervasyon iptal edilemiyor. "Taslak" durumu yok.
- **Düzeltme:** Açık bir geçiş tablosu:
  ```
  draft    → pending | cancelled
  pending  → approved | rejected | cancelled
  approved → cancelled
  ```
  `rejected` veya `cancelled` geçişinde aynı transaction içinde `booking_nights` üzerinden ilgili envanter satırlarını **tarih sırasıyla** `FOR UPDATE` kilitle ve `reserved` değerini geri azalt. Hangi rolün hangi geçişi yapabileceği Adım 3'teki karara göre belirlenmeli.
- **Test:** Kontenjan 1 → rezervasyon (reserved=1) → reddet (reserved=0) → yeni rezervasyon 201. Aynısını `approved → cancelled` için de yap. Tüm geçişler için izinli/izinsiz matris testi.

## ADIM 7 — Yetki ve doğrulama sertleştirmesi (Yüksek/Orta)

- **Y2 — Pasif acente:** `server/app.ts:17-32` (`authenticate`), `46-61` (login) ve `131-137` (satış sorgusu) içinde `agencies.active` kontrol edilmeli. Test: acente pasifleşince mevcut token ile `/api/me` 401, login 401, rezervasyon reddedilmeli.
- **Y4 — Pasif oda/fiyat planı:** Satış sorgusuna `AND r.active AND rp.active` ekle. Acente otel listesi tarih ve oda sayısı alıp yalnızca tüm geceler için müsaitliği olan ürünleri göstermeli. Test: pasif fiyat planına rezervasyon 404; kontenjanı olmayan tarihte otel listede görünmemeli.
- **O1 — Girdi doğrulama:** Şema doğrulama (ör. `zod`) kullan: UUID formatı, gerçek takvim tarihi (`2027-13-01` ve `2027-02-30` reddedilmeli), giriş tarihi bugünden önce olamaz, `1 ≤ rooms ≤ 10`, metin uzunluk sınırları, e-posta formatı. `Number.isFinite(nights)` kontrolü ekle; şu an `NaN` gece sayısı kontenjan döngüsünü tamamen atlıyor. Test: hiçbir geçersiz girdi 500 dönmemeli, hepsi 400 dönmeli.
- **O2 — Idempotency:** Transaction başında anahtarı `INSERT ... ON CONFLICT DO NOTHING` ile rezerve et; istek gövdesinin hash'ini sakla, farklı gövdeyle aynı anahtar gelirse `422`. Test: aynı anahtarla 10 paralel istek → hepsi aynı 201 yanıtı, tek rezervasyon (şu an 4'ü 500 dönüyor).
- **O3 — Rezervasyon numarası:** `Date.now()` yerine PostgreSQL `SEQUENCE` kullan (ör. `B4B-2026-000123`).
- **O9 — Hata yönetimi:** PostgreSQL hata kodlarını eşle (23503→400/404, 23505→409, 23514→409, 22P02→400); istemciye iç hata mesajı gönderme (bozuk JSON şu an ayrıştırıcı mesajını sızdırıyor). `server/db.ts:238-240` içinde ROLLBACK hatası orijinal hatayı gizlememeli; bozuk bağlantı `client.release(err)` ile atılmalı.
- **Sistem yöneticisi otel oluşturma (`server/app.ts:88`):** `ownerAgencyId` var mı ve ana acente mi kontrol edilmeli; şu an olmayan acente 500, alt acente sahibi otel 201 dönüyor.

## ADIM 8 — K4: Eksik v1 uç noktaları (Kritik)

Her biri sahiplik/rol kontrolü ve izolasyon testleriyle birlikte:

1. Kullanıcı yönetimi (oluşturma, parola atama, rol, pasifleştirme) + ilk sistem yöneticisini oluşturan CLI (`npm run admin:create`, parola stdin'den alınmalı, loglanmamalı).
2. Otel durumu güncelleme (`draft → active/inactive`). Şu an API ile oluşturulan otel hiçbir zaman aktif olamıyor.
3. Oda, pansiyon/fiyat planı CRUD.
4. Tarih aralığına toplu fiyat/kontenjan girişi. Kontenjanı rezerve edilenin altına düşürme 409 dönmeli.
5. Acenteye yayınlama CRUD: yalnızca otelin sahibi ana acente yayınlayabilir; hedef aktif bir alt acente olmalı.
6. Alt acente arama (tarih, konum, oda sayısı) ve kendi rezervasyonlarını listeleme/detay (`GET /api/agency/bookings`, `/:id`).
7. Back Office rezervasyon detayı, durum geçmişi, operasyon notu, sayfalama ve filtre.
8. **PDF voucher:** Yalnızca `approved` rezervasyon için; BED4BOOK logosuyla (renkler logo dosyasından alınmalı, tahmin edilmemeli); rezervasyon no, otel, tarihler, oda/pansiyon, misafir, operasyon notları. Erişim: rezervasyonu yapan alt acente, otelin ana acentesi, Back Office ve sistem yöneticisi. Üretim ve indirme audit'e yazılmalı. Kişisel ad, telefon veya unvan eklenmemeli.

**İzolasyon testi (Kabul Kriteri 3):** İki alt acente ile her yeni uç noktada (liste, fiyat, rezervasyon, detay, voucher) birbirinin verisine erişim denemesi 403/404 dönmeli.

## ADIM 9 — Güvenlik ve işletim (Yüksek/Orta)

- **Y7 — Giriş:** IP + e-posta bazlı hız sınırı ve geçici kilit; kullanıcı yoksa da sahte bir parola özetine karşı doğrulama yap (sabit yanıt süresi); başarılı/başarısız girişleri audit'e yaz.
- **O8 — Oturum:** `users.token_version` ile çıkış ve parola değişiminde token iptali. Tarayıcı için `HttpOnly; Secure; SameSite=Strict` çerez + CSRF koruması değerlendir.
- **O5 — RLS:** Ya `server/db.ts:234`'teki `set_config` çağrısını kaldır (şu an hiçbir RLS politikası yok, yanıltıcı) ya da gerçek RLS politikaları ve `BYPASSRLS` olmayan bir uygulama DB rolü ekle.
- **O7 — Audit:** Kullanıcı/rol, fiyat/kontenjan, yayın, voucher ve giriş olayları kayda geçmeli; uygulama DB rolünün audit tablosunda yalnızca `INSERT` yetkisi olmalı.
- **O10 — Migration:** `schema_migrations` tabanlı bir çalıştırıcı (`npm run db:migrate`).
- **O11 — HTTP:** `helmet`, yalnızca `https://www.bed4book.com` için CORS, `trust proxy`, graceful shutdown, veri tabanını da kontrol eden `/health/ready`.
- **Düşük öncelikli:** scrypt parametrelerini hash içinde sakla (N=2^17); `Bearer` önekini zorunlu yap; token süresini (`expiresIn`) tek sabitten al; para hesabını float yerine `numeric` ile yap; `images`/`amenities` alanlarını doğrula.

---

## Teslim formatı (her adım için)

```
Adım: <numara ve başlık>
Düzeltilen bulgular: <K1, Y2, ...>
Değişen dosyalar: <liste>
Komutlar: <çalıştırılacak komutlar>
Test çıktısı: <gerçek çıktı, kısaltmadan>
Açık kalanlar / katılmadığım bulgular: <gerekçeyle>
```

Tüm adımlar bittiğinde Claude, aynı test betiğiyle kodu bağımsız olarak yeniden inceleyecek.
