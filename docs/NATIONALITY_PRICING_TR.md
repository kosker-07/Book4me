# BED4BOOK — Milliyet Bazlı Kontrat Fiyatlandırması, Döviz ve Proforma

- Sürüm: 1.0 — 08.11.2026
- Dal: `claude/clever-thompson-awnwcc`
- Kaynak: "Nationality-Based Contract Pricing Specification (Revised v2)". Proje sahibi, değerlendirme raporundaki önerilen seçeneklerin tamamını uygulama talimatıyla onayladı (§2).
- Durum: Uygulandı ve test edildi (§8). Üretime kurulmadı.

## 1. Değişmeyen ürün kuralları

1. **Kilit yok.** Arama hiçbir şey yazmaz. Kontenjan her gece için tek bir atomik koşullu `UPDATE` ile düşer; açık satır kilidi yoktur.
2. **En düşük fiyat kazanır.** Eşdeğerlik anahtarı başına tek kazanan seçilir. Kaybeden ve uygun olmayan teklifler döndürülmez.
3. **İkinci teklife geçiş yok.** Kazanan yeniden doğrulamada başarısız olursa rezervasyon reddedilir. Başka kontrat, başka pazarın fiyatı veya başka fiyat planı denenmez.
4. **Back Office platform genelinde yetkilidir.**
5. **İptal yetkileri ve kalıcı fiyat kaydı** önceki kararlardaki gibidir.

## 2. Verilen kararlar

| # | Karar | Uygulama |
|---|---|---|
| 1 | Öncelik sırası yalnız **uygunluğu** belirler; uygunlar arasında en düşük fiyat kazanır | `server/eligibility.ts`, `server/pricing.ts` |
| 2 | Uyruk eksikse aramada **400 `NATIONALITY_REQUIRED`** | `POST /api/agency/searches` |
| 3 | **Tek aile milliyeti:** tüm yetişkinler ve çocuklar için aramada seçilen tek milliyet kontrata uygun olmalı | `evaluateContract` |
| 4 | Kontenjan **fiyat planı başına** kalır (sözleşme kontenjanı); fiziksel stok sorumluluğu otelindir | Şema değişmedi |
| 5 | Kur **rezervasyon anında** dondurulur; quote'taki kur id'si yeniden doğrulanır. En fazla 96 saatlik kur kullanılır (`FX_MAX_AGE_HOURS`) | `server/fx.ts`, `revalidateFx` |
| 6 | Sabit markup **kontrat para biriminde** | `nightlySellMinor` |
| 7 | Kur kaynağı: **ECB** günlük kurları (`npm run fx:import-ecb`). ECB'nin yayınlamadığı para birimleri onaylı alternatif kaynaktan `POST /api/admin/fx-rates` ile girilir | `server/cli/import-ecb-rates.ts` |
| 8 | Proforma **bekleyen ve onaylı** rezervasyon için; "vergi faturası değildir"; satıcı olarak kontrattaki tüzel kişi | `server/proforma.ts` |
| 9 | Uygunluk sonradan değişirse **mevcut rezervasyon korunur** (kalıcı kayıt) | `booking_price_snapshots` değiştirilemez |
| 10 | Kontenjan düşüm anı **talep anında** kalır (bu iş kapsamında değiştirilmedi) | `reserveNights` |
| 11 | Milliyet fiyatı ve proforma **Faz 1 kapsamına** alındı | — |
| 12 | Uyruk = **pasaport vatandaşlığı** | API alan açıklamaları |
| 13 | Çifte vatandaşlık: rezervasyonda **seçilen tek pasaport** | Aile başına tek uyruk |
| 15 | Bir kontrat konaklamanın **bütün gecelerini** kapsamalı; geceler kontratlar arasında bölünmez | `valid_from`/`valid_to` kontrolü |
| 17 | Taslak oluşturulurken **tam fiyat kaydı** yazılır; gönderimde kontrat, uygunluk, kur ve fiyat yeniden doğrulanır | `POST /api/agency/bookings/{id}/submit` |
| Y1 | 32 para birimi (ISO 4217), 3 ondalıklılar dahil (KWD, BHD, OMR, JOD) | Migration 005 |
| Y3 | Kurlar hem otomatik (ECB) hem elle (Back Office / sistem yöneticisi) güncellenir | — |
| Y4 | Quote sürüm 1 reddedilir (en fazla 30 dk'lık geçiş etkisi) | `server/quotes.ts` |
| Y5 | 006 öncesi rezervasyonlar eski kayıt olarak kalır; misafir listesi geriye doldurulmaz. Fiyat kaydı olmayan eski taslak gönderilemez (`DRAFT_REQUIRES_NEW_QUOTE`) | — |
| Y6 | `agency_conditions` kullanılmıyor ve fiyatlandırmaya katılmıyor; kaldırılması ayrı kararla yapılır | — |
| Y7 | Yayın **fiyat planı bazında** kalır | `agency_hotel_sales` |

**96 saat gerekçesi:** ECB hafta sonları ve TARGET tatillerinde (ör. Kutsal Cuma ile Paskalya Pazartesi arası) kur yayınlamaz. 24 saatlik bir sınır, cumartesiden itibaren EUR dışındaki bütün teklifleri aramadan çıkarırdı. Süre ortam değişkeniyle değiştirilebilir.

## 3. Veri modeli (tekrar yok)

Fiyatın tek kaynağı değişmedi:
- Gecelik net fiyat ve kontenjan: `inventory_daily`
- Para birimi: `rate_plans.currency`
- Yayın ve markup: `agency_hotel_sales`

| Tablo | Amaç | Migration |
|---|---|---|
| `schema_migrations` | Migration çalıştırıcı kaydı (ad + SHA-256) | runner |
| `audit_logs` (+ alanlar) | `target_agency_id`, `before`, `after`, `ip`, `user_agent`, `request_id`; yalnız eklenebilir | 004 |
| `countries` | ISO 3166-1 alfa-2 (249 ülke) | 005 |
| `currencies` | ISO 4217 izin listesi, küsurat basamağı, aktiflik | 005 |
| `fx_rate_history` | Her kur kaydı; quote ve kalıcı kayıt bu id'ye bağlanır | 005 |
| para sütunları | En fazla 3 ondalıklı `numeric`; mevcut değerler ve metin biçimi (`"100.00"`) değişmez | 005 |
| `hotel_contracts` | Otel kontratı: kod, para birimi, geçerlilik, satıcı tüzel kişi, durum, varsayılan | 006 |
| `contract_rate_plans` | Fiyat planı → kontrat. Her fiyat planı tam bir kontrata bağlıdır; para birimi ve otel aynı olmalıdır | 006 |
| `market_groups`, `market_group_members` | Adlandırılmış ülke grupları | 006 |
| `contract_nationality_rules` | `include` / `exclude`; hedef tek ülke ya da grup | 006 |
| `booking_guests` | Misafir başına ad, tip, yaş, uyruk; değiştirilemez | 006 |
| `booking_price_snapshots` | Kontrat, uyruklar, eşleşen kurallar, tutar, kurlar, ödeme para birimi ve tutarı; değiştirilemez | 006 |
| `proformas`, `proforma_counters` | Numaralı, sürümlü, değiştirilemez proforma ve PDF | 006 |

**Geçiş:** Mevcut fiyat planları otelin para birimine göre "GENERAL-EUR" gibi varsayılan genel pazar kontratına bağlanır. Varsayılan kontratın kuralı yoktur, yani her uyruğa açıktır. Yeni fiyat planı açıkça kontrat verilmezse aynı varsayılana otomatik bağlanır. Bu sayede otel kural tanımlayana kadar davranış birebir aynı kalır.

## 4. Uygunluk ve fiyat akışı

Akış sırası:
1. Kontrat
2. Aile milliyeti
3. Uygunluk
4. Tarih ve oda müsaitliği
5. Kontrat net fiyatı
6. Acente markup'ı
7. EUR'ya çevrilerek karşılaştırma
8. Eşdeğerlik anahtarı başına en düşük uygun teklif
9. İmzalı quote
10. Rezervasyon (yeniden doğrulama + kalıcı kayıt)
11. Proforma (yalnız kalıcı kayıttan)

**Bir kontrat ve bir uyruk için uygunluk sırası:**
1. Hariç tutma (tam ülke veya o ülkeyi içeren grup) → uygun değil. Hariç tutma her zaman kazanır.
2. Tam ülke dahil etme → uygun.
3. Grup dahil etme → uygun.
4. Hiç dahil etme kuralı yok (genel pazar) → uygun.
5. Diğer durumlar → uygun değil.

Daha özel bir kontrat, daha ucuz genel kontratı geçersiz kılmaz. Otel bir pazarın yalnız kendi özel fiyatını görmesini istiyorsa, o pazarı genel kontrattan açıkça hariç tutmalıdır.

**Eşdeğerlik anahtarı:** otel, oda, pansiyon, iptal, ödeme, satış koşulları, doluluk, tarihler, oda sayısı ve tek aile milliyeti. Kontrat anahtarda yer almaz; uygun kontratlar birbiriyle yarışır.

## 5. API

### 5.1 Arama — `POST /api/agency/searches`

```json
{ "checkIn": "2026-12-01", "checkOut": "2026-12-03", "rooms": 1, "adults": 2, "children": 1, "childAges": [7],
  "roomOccupancies": [{ "adults": 2, "children": 1, "childAges": [7] }], "nationalities": ["TR"], "paymentCurrency": "EUR" }
```

**Alanlar:**
- `nationalities`: ailedeki bütün yetişkin ve çocuklar için **tek** pasaport milliyeti (`["TR"]`).
- `paymentCurrency`: isteğe bağlı; verilmezse kontrat para birimi kullanılır.

**Hatalar:**
- `400 NATIONALITY_REQUIRED`
- `400 VALIDATION_FAILED` (`nationalities`: `ONE_NATIONALITY_PER_FAMILY` veya `ISO_3166_ALPHA2_REQUIRED`)
- `400 PAYMENT_CURRENCY_NOT_SUPPORTED`
- `409 FX_RATE_UNAVAILABLE`

**Sonuç:** Her sonuç `total`, `currency`, `payment: {currency, total}` ve gerekiyorsa `fx` alanlarını içerir. Kontrat id'si, net fiyat ve markup yanıtta yer almaz.

### 5.2 Rezervasyon — `POST /api/agency/bookings`

```json
{ "quoteId": "q2....", "guest": { "firstName": "...", "lastName": "...", "adults": 2, "children": 1, "childAges": [7],
  "email": "...", "phone": "...", "nationality": "TR" },
  "otherGuests": [ { "firstName": "...", "lastName": "...", "type": "adult" },
                   { "firstName": "...", "lastName": "...", "type": "child", "age": 7 } ],
  "operationNote": "...", "draft": false }
```

**Alanlar:** `otherGuests`, ana misafir dışındaki herkesi içerir. Diğer misafirlerin milliyeti isteğe bağlıdır; fiyat ve kontrat kararını etkilemez. Kayıtta tüm misafirlere imzalı teklifle eşleşen aile milliyeti uygulanır.

**Yeniden doğrulama hataları (hepsi 409, başka teklif denenmez):**
- `QUOTE_NATIONALITY_MISMATCH`
- `CONTRACT_CHANGED`
- `CONTRACT_NOT_AVAILABLE`
- `NATIONALITY_NOT_ELIGIBLE`
- `PRICE_CHANGED` (`reason: FX_RATE_CHANGED` dahil)
- `ALLOTMENT_UNAVAILABLE`

**Detay yanıtı:** Rezervasyon detayı `guests` ve `priceSnapshot` alanlarını içerir.

### 5.3 Proforma

| Uç nokta | Yetki | Açıklama |
|---|---|---|
| `GET /api/agency/bookings/{id}/proforma` | alt acente (kendi rezervasyonu) | İlk çağrıda sürüm 1 üretilir (201), sonrakilerde saklanan belge döner (200) |
| `GET /api/backoffice/bookings/{id}/proforma` | Back Office, sistem yöneticisi (tümü); ana acente (kendi otelleri) | Aynı |
| `POST /api/backoffice/bookings/{id}/proforma/reissue` | Back Office, sistem yöneticisi | `{ "reason": "..." }` ile yeni numaralı sürüm üretir |
| `GET /api/backoffice/bookings/{id}/proformas` | Back Office kapsamı | Sürüm geçmişi |

**Kurallar:**
- Yalnız `pending` ve `approved` rezervasyonlar; diğer durumlarda `409 PROFORMA_REQUIRES_PENDING_OR_APPROVED_BOOKING`.
- Numara biçimi `PF-YYYY-NNNNNN`; yıllık, ardışık ve eşzamanlı isteklerde çakışmasız.

### 5.4 Yönetim

| Uç nokta | Yetki |
|---|---|
| `POST/GET /api/admin/hotels/{id}/contracts`, `GET/PATCH /api/admin/contracts/{id}` | system_admin, back_office: tümü; master_agency: kendi otelleri |
| `POST /api/admin/contracts/{id}/rate-plans` (fiyat planını taşı: aynı otel ve para birimi) | aynı |
| `POST /api/admin/contracts/{id}/nationality-rules`, `DELETE /api/admin/nationality-rules/{id}` | aynı |
| `GET /api/admin/contracts/{id}/eligibility?nationalities=DE,CH` (önizleme) | aynı |
| `POST /api/admin/market-groups`, `PUT /api/admin/market-groups/{id}/countries` | system_admin, back_office |
| `GET /api/admin/market-groups` | yönetim rolleri |
| `GET /api/admin/currencies`; `PATCH /api/admin/currencies/{code}` | okuma: yönetim rolleri; değişiklik: system_admin |
| `GET /api/admin/fx-rates`; `POST /api/admin/fx-rates` | okuma: yönetim rolleri; giriş: system_admin, back_office |
| `POST /api/admin/rooms/{id}/rate-plans` (+ isteğe bağlı `contractId`) | yönetim rolleri |

- Alt acentenin hiçbir yönetim uç noktasına erişimi yoktur.
- Kontratın para birimi, oteli ve kodu değiştirilemez.
- Bütün değişiklikler önceki/sonraki değerle audit'e yazılır.

### 5.5 Komutlar

| Komut | İşlev |
|---|---|
| `npm run db:migrate` | Bekleyen migration'ları uygular |
| `npm run db:migrate -- --status` | Uygulanmış ve bekleyen migration'ları listeler |
| `npm run db:migrate -- --baseline 003_draft_sessions_vouchers.sql` | Elle uygulanmış 001–003'ü şemayı doğrulayarak kayda geçirir |
| `npm run fx:import-ecb [-- --file kurlar.xml]` | ECB kurlarını içe aktarır |
| `npm run admin:create -- <e-posta>` | İlk yöneticiyi oluşturur (parola stdin'den) |

## 6. Yönetim arayüzü tanımı

Mevcut tarayıcı arayüzü henüz bu API'ye bağlı değil. Aşağıdakiler uygulanacak ekranların tanımıdır.

1. **Kontrat listesi (otel sayfası)**
   - Kod, ad, para birimi, geçerlilik, durum, fiyat planı sayısı ve kural sayısı.
   - Varsayılan genel kontrat işaretli gösterilir.
   - "Yeni kontrat" düğmesi.
2. **Kontrat düzenleyici**
   - Alanlar: ad, geçerlilik tarihleri, satıcı tüzel kişi, durum.
   - Para birimi ve kod salt okunur.
   - Fiyat planı listesi ve "Bu kontrata taşı" eylemi. Farklı para birimindeki planlar seçilemez.
3. **Uyruk kuralı düzenleyici**
   - İki liste: "Hariç tutulanlar" (her zaman önce gösterilir) ve "Dahil edilenler".
   - Her biri ülke ya da grup ekleyebilir.
   - Hiç dahil etme kuralı yoksa "Tüm pazarlara açık (genel)" etiketi gösterilir.
4. **Hariç-tutma-öncelikli önizleme**
   - Ülkeler girilir; her biri için sonuç (`HARİÇ`, `TAM`, `GRUP`, `GENEL`, `DAHİL DEĞİL`) ve eşleşen kural gösterilir.
   - Kaynak: `GET /api/admin/contracts/{id}/eligibility`.
   - Karma milliyette tek bir uygun olmayan misafir bütün kontratı uygun dışı yapar; bu açıkça gösterilmelidir.
5. **Pazar grupları:** Liste, ülke çoklu seçimi; yalnız Back Office ve sistem yöneticisi düzenler.
6. **Para birimleri ve kurlar**
   - 32 para biriminin listesi, küsurat basamağı ve aktiflik.
   - Güncel kur, kaynak ve yaşı (saat). 96 saati aşan kur kırmızıyla gösterilir: "aramaya katılmıyor".
   - Elle kur girişi formu (kaynak alanı zorunlu).
7. **Rezervasyon fiyat kaydı görünümü (Back Office ve acente detayı)**
   - Kontrat kodu, uyruklar ve eşleşen kurallar.
   - Kontrat tutarı ve para birimi, kur (değer, kaynak, tarih), ödeme para birimi ve tutarı.
   - "Bu değerler rezervasyon anında dondurulmuştur" notu.
8. **Proforma**
   - "Proforma indir" düğmesi yalnız bekleyen ve onaylı rezervasyonlarda.
   - Back Office için "Yeni sürüm üret" (gerekçe zorunlu) ve sürüm geçmişi.
9. **Arama formu**
   - Misafir başına uyruk alanı (pasaport); boş bırakılamaz.
   - İsteğe bağlı ödeme para birimi.
   - Sonuçta ödenecek tutar ve kur bilgisi.

## 7. Bilinen sınırlar ve açık işler

- **Kontenjan düşüm anı** (talep anı / Back Office onayı): mevcut davranış korunuyor, karar hâlâ açık.
- **Tarayıcı arayüzü** bu API'ye bağlı değil (§6 yalnız tanım).
- **Canlı ECB içe aktarma:** Bu ortamda `fetch failed` ile başarısız oldu, nedeni araştırılmadı. Ayrıştırıcı ve içe aktarma, örnek dosyayla test edildi.
- **Proforma PDF'leri** şimdilik veritabanında (`bytea`) saklanıyor; nesne depolamaya taşınması altyapı kararına bağlı.
- **`audit_logs` değiştirilemezliği** veritabanı tetikleyicisiyle sağlanıyor. Uygulama rolüne yalnız `INSERT` yetkisi verilmesi üretim veritabanı rol kurulumunda yapılmalı.
- **Para birimi listesi:** 32 para birimi seçildi. Listeye eklenecek veya çıkarılacak para birimi varsa proje sahibi bildirmelidir.

## 8. Doğrulama

| Kontrol | Sonuç |
|---|---|
| `npm run test:server` (PostgreSQL 16) | 89/89 geçti |
| Mutation M1–M24 | 24/24 yakalandı (M23 ilk denemede kaçtı; N12 iki ayrı kur senaryosuyla güçlendirildi ve M24 eklendi) |
| Boş veritabanı, runner ikinci geçiş, elle tekrar uygulama, 001'den yükseltme | Geçti |
| Yedek → geri yükleme tatbikatı (yeni tablolar dahil) | `RESTORE DRILL PASSED` |
| Performans | Arama p95 186 ms, rezervasyon p95 54 ms (yerel, 4 vCPU) |
\n## Aile milliyeti kuralı (ürün sahibi kararı)\n\nAramada seçilen tek ISO 3166-1 alpha-2 milliyet bütün aile için geçerlidir; yetişkin, çocuk ve oda sayısı bunu değiştirmez. Kontrat uygunluğu, hariç tutma/dahil etme ve fiyat seçimi backend tarafından yalnızca bu kodla hesaplanır. Ana misafir milliyeti imzalı teklifteki aile milliyetinden farklıysa `409 QUOTE_NATIONALITY_MISMATCH` döner. Diğer misafirlerde milliyet boş bırakılabilir; kayıtta aile milliyeti kullanılır. Oda bazında kapasite kontrolleri ayrıca zorunludur. Çoklu milliyet dizisi `400 VALIDATION_FAILED` ve `ONE_NATIONALITY_PER_FAMILY` ile reddedilir.\n