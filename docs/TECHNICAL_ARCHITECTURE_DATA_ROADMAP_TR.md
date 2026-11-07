# BED4BOOK — Teknik Mimari, Veri Altyapısı ve Kurulum Yol Haritası

- Belge: Teknik Mimari ve Veri Yol Haritası
- Sürüm: **2.0** (v1.0'ın bağımsız denetim sonrası revizyonu)
- Tarih: 07.11.2026
- Depo: `kosker-07/Book4me`
- Bağlayıcı kapsam: `docs/BED4BOOK_Teknik_Sartname.md`, `docs/BED4BOOK_Proje_Sartnamesi.md`, `docs/IMPLEMENTATION_PLAN_BED4BOOK_V1.md`
- Denetim raporu: `docs/reviews/CLAUDE_ARCHITECTURE_ROADMAP_REVIEW.md` (madde kodları bu belgede köşeli parantezle anılır, ör. [A1])
- Durum: Tasarım önerisi. Üretim ortamına kurulmamıştır. **"ÖNERİLEN — ONAY BEKLİYOR"** işaretli maddeler proje sahibi onaylayana kadar kesin karar değildir (bkz. §13).

## Sürüm 2.0'da değişenler

| Konu | v1.0 | v2.0 |
|---|---|---|
| Ürün tanımı | Çok tedarikçili API meta-arama | BED4BOOK v1.0: manuel envanter, alt acenteye yayın, Back Office onayı, PDF voucher [A1, A4] |
| Rezervasyon akışı | Supplier recheck → supplier create → CONFIRMED | Taslak → Beklemede → Back Office onay/ret → Onaylandı/Reddedildi/İptal → voucher [A1] |
| Kilit yok + kontenjan | İlişki tanımsız | Onay anında tek ifadeli atomik koşullu düşüm; açık kilit yok [A3] |
| Backend | NestJS + Prisma, `apps/api` | Mevcut PR #2 temeli: Express 5 + `pg` + sürümlü SQL migration, `server/` [T1, T3] |
| PostgreSQL | 18 | 16 (şartname §6) [T2] |
| Redis/BullMQ, React, OTel | v1'de | v1 sonrası [T4, T5, T8] |
| Veri modeli | Tedarikçi teklif odaklı | `rate_calendar`, `agency_publications`, `agency_price_rules`, `booking_nights`, `vouchers` eklendi [A2, D1] |
| Rebooking / RateRelay | v1 modül listesinde | v1 dışı; ayrı onay [A5] |
| Mevcut durum | 2 Rebooking uygulaması | 3 uygulama (u002e, u0030, u008), test durumu gerçek çıktıyla [R-1] |

---

## 1. Yönetici özeti

BED4BOOK v1.0, yalnızca web tarayıcısında çalışan bir B2B otel toptan satış platformudur. Yetkili kullanıcılar otel, oda, pansiyon, tarih bazlı fiyat ve kontenjanı **manuel** girer; seçilen ürünler alt acentelere açılır; alt acente rezervasyon talebi oluşturur; Back Office onaylar veya reddeder; onaylanan rezervasyon için BED4BOOK markalı PDF voucher üretilir.

Bugünkü depo iki parçadan oluşur:

1. **Tarayıcı uygulaması (`main`):** tek HTML dosyası, tüm veri ve iş kuralları tarayıcıda (LocalStorage/Memory adaptörü). Üretim için kayıt sistemi değildir.
2. **Sunucu temeli (PR #2, `feature/bed4book-v1-server-foundation`):** Node.js 22 + TypeScript + Express 5 + PostgreSQL şeması. İlk uç noktalar mevcut; v1 modüllerinin çoğu eksik.

**Önerilen yön:** PR #2 temeli üzerinde tek bir modüler monolit backend; PostgreSQL 16; S3 uyumlu dosya depolama; GitHub Actions'ta gerçek PostgreSQL ile test. Mevcut ekranlar korunur ve use-case bazlı API'lere bağlanır. Ek altyapı (Redis, kuyruk sistemi, yeni UI çatısı, tedarikçi entegrasyonu) ancak v1 canlıya çıktıktan ve ihtiyaç ölçüldükten sonra eklenir.

## 2. Değişmez ürün kuralları

Bu kurallar tasarım, API, veritabanı, arayüz ve testlerde aynı şekilde uygulanır; gevşetilemez.

1. **Rezervasyon tutma/kilitleme yok:** Arama sırasında rezervasyon kaydı, geçici rezervasyon, oda/stok/kontenjan kilidi veya süreli envanter tutma oluşturulmaz. Arama sonucu yalnızca zaman damgalı fiyat ve müsaitlik gözlemidir.
2. **Tek kazanan fiyat:** Karşılaştırılabilir ve tüm uygunluk kontrollerini geçen teklifler arasında normalize edilmiş toplam fiyatı en düşük olan yalnızca bir teklif seçilir.
3. **Alternatif teklif gösterilmez:** Kazanan dışındaki teklifler kullanıcıya alternatif, ikinci seçenek veya otomatik yedek olarak sunulmaz. İç denetim için sınırlı süreli iz tutulabilir; bu kayıtlar arayüze, API yanıtına, dışa aktarıma veya genel loglara sızamaz.
4. **Yalnız kazananı yeniden doğrula:** Rezervasyon kesinleşirken yalnızca kazanan teklifin fiyatı ve müsaitliği yeniden doğrulanır.
5. **Otomatik ikinci sıraya geçiş yok:** Yeniden doğrulama başarısızsa rezervasyon reddedilir ve yeni arama istenir; ikinci teklif devreye alınmaz.
6. **Onay olmadan kesinleşme yok:** Rezervasyon ancak yetkili onayı ve başarılı kontenjan düşümüyle Onaylandı olur.
7. **İş akışları ayrıdır:** Arama/rezervasyon ile ileride eklenebilecek Rebooking ve RateRelay ayrı domain süreçleridir; karar kuralları karıştırılmaz.

### 2.1 Kuralların v1.0'a uygulanması

v1'de tedarikçi API'si yoktur; ürünün kaynağı otelin sahibi ana acentedir.

| Kural | v1.0 karşılığı |
|---|---|
| 4 — yalnız kazananı yeniden doğrula | Back Office "Onayla" dediğinde yalnızca rezervasyonun bağlı olduğu kazanan fiyat planının o anki fiyatı ve kontenjanı kontrol edilir. |
| 5 — ikinci sıraya geçiş yok | Kontrol başarısızsa rezervasyon `Reddedildi` olur (sebep `NO_AVAILABILITY` veya `PRICE_CHANGED`); başka fiyat planı, oda, otel veya ana acente denenmez; acenteye yeni arama yapması bildirilir. |
| 6 — onay olmadan kesinleşme yok | `Onaylandı` yalnızca Back Office onayı + aynı transaction içinde başarılı kontenjan düşümü ile oluşur. |

### 2.2 "Kilit yok" ile "kontenjan aşımı yok" birlikte nasıl sağlanır [A3]

Teknik Şartname Kabul Kriteri 4, eş zamanlı taleplerde kontenjan tutarsızlığının ve mükerrer rezervasyonun engellenmesini ister. Kural 1 ile çelişmez; ayrım şöyledir:

| Kavram | Durum |
|---|---|
| Arama sırasında oda/kontenjan tutma | **Yasak.** Arama hiçbir envanter kaydına yazmaz. |
| Süreli geçici rezervasyon (opsiyon, hold) | **Yasak.** Durum makinesinde `HOLD/HELD/LOCKED/OPTION` yoktur. |
| Açık satır kilidi (`SELECT … FOR UPDATE`) | **Kullanılmaz.** |
| Tek SQL ifadesiyle atomik koşullu düşüm | **Kullanılır.** `UPDATE rate_calendar SET sold = sold + :n WHERE … AND allotment - sold >= :n AND NOT stop_sale`; etkilenen satır yoksa işlem geri alınır. Kalıcı tutma oluşmaz; ifade milisaniyeler içinde biter. |

Mükerrer rezervasyon `Idempotency-Key` benzersiz kaydıyla engellenir (§5.6).

**Kontenjan hangi anda düşer? — ÖNERİLEN — ONAY BEKLİYOR (§13, karar 1):** Yalnızca **Back Office onayı anında**. `Beklemede` talep kontenjanı tüketmez; böylece onay bekleyen talep odayı fiilen tutmaz. Bedeli: onay bekleyen talebin odası bu sürede başka acenteye satılabilir; bu, kilit yok kuralının doğal sonucudur. Alternatif (talep anında düşüm) PR #2'nin ilk davranışıdır ve süresiz bir envanter tutma anlamına gelir; bu nedenle önerilmez.

### 2.3 Tek kazananın tanımı [D3, D5]

- **Eşdeğerlik anahtarı** — ÖNERİLEN — ONAY BEKLİYOR (§13, karar 3): `canonical_property_id`, `room_type_code`, `board_code`, doluluk (oda başına yetişkin sayısı ve çocuk yaşları), giriş ve çıkış tarihi, `cancellation_class`, `payment_class`, pazar/milliyet.
- **Uygunluk:** yayın aktif; otel, oda ve fiyat planı aktif; tüm geceler için fiyat var; her gece `allotment - sold >= oda sayısı`; stop-sale yok; pazar ve kapasite uygun; kur mevcut.
- **Normalize toplam:** Σ(gecelik net fiyat) → acente fiyat kuralı → karşılaştırma para birimine çevrim (quote anındaki kur kaydıyla). Tüm hesap `NUMERIC` ile. **Kuru bulunmayan teklif karşılaştırmaya girmez** (sessizce 1 kabul edilmez).
- **Tie-break** — ÖNERİLEN — ONAY BEKLİYOR (§13, karar 6): `normalized_total ASC`, sonra kaynak (ana acente) id, sonra fiyat planı id. Sonuç deterministiktir.
- **Yanıt:** eşdeğerlik anahtarı başına tam bir kayıt. Kaybeden tekliflerin fiyatı, kaynağı ve sayısı yanıtta, dışa aktarımda ve loglarda yer almaz.

## 3. Mevcut durum (kodla doğrulanmış)

### 3.1 Tarayıcı uygulaması (`main`)

- `tools/build.js:5-14`: `src/` modülleri ve `src/updates/u*.js` dosyalarının **tamamı** tek `dist/index.html` içine derlenir.
- `src/core/store.js:44-62`: tüm veri tek JSON belge olarak **senkron** okunur ve yazılır; `ServerAdapter` (`store.js:30-38`) çalışmayan bir iskelettir. "Yalnız adaptör değişir" yaklaşımı çok kullanıcılı, yetkili ve transaction'lı bir API ile uyumlu değildir; UI use-case bazlı API çağrılarına geçirilmelidir [T6].
- `src/core/store.js:66-74`: kiracı ayrımı tarayıcıda filtredir; güvenlik sınırı değildir. Kiracı haritasında olmayan koleksiyonlar tüm kiracılara görünür sayılır (`store.js:68`) [R-7].
- `src/domain/search.js`: arama fonksiyonları salt okunurdur; arama sırasında envanter tutulmaz (Kural 1 ile uyumlu). Eksikler [C1-C4]:
  - otel eşdeğerliği `ad|şehir` metni (`search.js:15`),
  - teklif eşdeğerliğinde pansiyon yok; pansiyon filtresi yalnız grubun ilk otelinde (`search.js:19, 38`),
  - bilinmeyen para birimi kur 1 sayılır (`src/domain/pricing.js:6`),
  - eşit fiyatta deterministik sıralama yok (`search.js:21`),
  - oda tipi başına iade edilebilir ve iade edilemez fiyat birlikte döner (`search.js:34-35`) — iptal koşulu eşdeğerlik anahtarındaysa uyumludur (§13, karar 3).
- `src/domain/booking.js:24-36`: `BK.place` istemciden gelen fiyatı yeniden doğrulamadan kaydeder ve durumu doğrudan `"Onaylı"` yapar [B1]. `src/domain/integrations.js:118-124` API Out canlı modda `confirmed` döner [B2]. **Bu akış üretimde kullanılmamalıdır.**
- `o.hold` (`src/domain/accounting.js:49-57`) envanter tutma değil, **ön ödeme teminat blokajıdır**.
- Parolalar tuzlu SHA-256 ile özetlenir (`src/core/app.js:27`), demo şifresi `book4me` (`src/domain/auth.js:17`), asgari 6 karakter [S1]. Bu hash'ler üretime taşınmaz.
- Rebooking/RateRelay için **üç** paralel uygulama aynı pakettedir: `u002e-rebooking.js` (eski, "tutma hakkı" ve risk grubu içerir), `u0030-bed4book-core.js`, `u008-bed4book-core.js` [R-1]. v1 kapsamı dışındadır; bilinen hatalar denetim raporu R-2…R-8'dedir.

### 3.2 Sunucu temeli (PR #2)

- `server/app.ts`, `server/db.ts`, `server/security.ts`, `server/migrations/001_initial.sql`: giriş, oturum, otel oluşturma, acente otel listesi, rezervasyon oluşturma, Back Office kuyruğu ve durum güncelleme.
- Parolalar tuzlu scrypt; oturum HMAC imzalı; kiracı bağlamı token'dan türetilir; her istekte kullanıcı DB'den doğrulanır.
- Bu revizyonla birlikte yapılan kod düzeltmeleri: rezervasyon oluşturmadaki parametre hatası giderildi; açık `FOR UPDATE` kilidi kaldırılıp gece başına tek ifadeli atomik koşullu düşüme geçildi; gerçek PostgreSQL ile entegrasyon testleri ve CI eklendi (bkz. §11).
- Açık eksikler: `docs/reviews/CLAUDE_V1_TECHNICAL_REVIEW.md` (K2-K4, Y1-Y7, O1-O11).

### 3.3 Test durumu (07.11.2026, Node 22)

| Komut | Sonuç |
|---|---|
| `npm run test:server` (DATABASE_URL ile) | 8/8 geçti (2 birim + 6 PostgreSQL entegrasyon) |
| `node tests/u008-bed4book.js` | Geçti — bu revizyonda iki hatalı test beklentisi düzeltildi |
| `node tests/bed4book.js` | Geçti |
| `node tests/unit.js` | 26 geçti, 4 kaldı — 4'ü depo dışı fikstür yolu (`/home/user/paket/...`) |
| Tarayıcı testleri (`tests/ui-flow.js` vb.) | Doğrulanmadı |

## 4. Hedef teknoloji mimarisi (v1.0)

### 4.1 Teknoloji kararları

| Katman | Karar | Gerekçe |
|---|---|---|
| Web istemcisi | Mevcut ekranlar korunur, use-case API'lerine bağlanır | Şartname §5 "mevcut kullanılabilir ekranlar korunarak"; 4-6 haftalık plan [T5] |
| Backend | Node.js 22 LTS + TypeScript + **Express 5** (PR #2 temeli), modüler monolit — ÖNERİLEN — ONAY BEKLİYOR (§13, karar 2) | Mevcut çalışan temel; ikinci backend açılmaz [T1] |
| Doğrulama / log | `zod` şema doğrulama; `pino` JSON log + `x-request-id` | Girdi hatalarının 500 yerine 400 dönmesi; izlenebilirlik |
| API | REST, `/api/v1`, OpenAPI 3.1 | B2B için anlaşılır ve sürümlenebilir |
| Veritabanı | **PostgreSQL 16**, yönetilen hizmet (TR/AB bölgesi) — sürüm ÖNERİLEN — ONAY BEKLİYOR (§13, karar 9) | Şartname §6 [T2] |
| Migration | Sürümlü **ham SQL** (`node-pg-migrate` veya eşdeğeri), `schema_migrations`; isteğe bağlı Kysely ile tip güvenliği | Atomik koşullu güncelleme, CHECK, kısmi unique indeks ve RLS doğrudan SQL ister; tek şema kaynağı [T3] |
| Arka plan işleri | PostgreSQL `outbox_events` + aynı kod tabanında worker süreci (veya `pg-boss`) | v1 yükü düşük; ek servis gerekmez [T4] |
| Dosya | S3 uyumlu nesne depolama; DB'de yalnız anahtar ve checksum | Görsel ve voucher PDF |
| Kimlik | Sunucu oturumu, `HttpOnly; Secure; SameSite=Strict` çerez + CSRF koruması; sistem yöneticisine MFA | İstemci state'i yetki kanıtı değildir |
| PDF | Sunucuda üretim (`pdfkit` veya `pdf-lib`), logo kaynak dosyasından | Şartname §4.4 |
| Gözlemlenebilirlik | JSON log, hata izleme, uptime kontrolü | Şartname §8 "hata kayıtları" |
| Dağıtım | Docker; tek uygulama sunucusu (4 vCPU / 8 GB / Ubuntu 24.04, Şartname §6) + yönetilen PostgreSQL; Caddy veya Nginx ile TLS | Şartname §6 başlangıç profili |
| CI/CD | GitHub Actions: `npm ci`, typecheck, birim, PostgreSQL 16 servisli entegrasyon testi, migration doğrulama, bağımlılık taraması | Şartname §8 |
| Güvenlik | OWASP ASVS 5.0.0 tabanlı kontrol listesi | — |

**v1'de kullanılmayacaklar:** NestJS, Prisma, Redis/BullMQ, React/Vite yeniden yazımı, OpenTelemetry, tedarikçi adaptörleri, ödeme/ledger. Bunlar §10 "v1 sonrası" bölümündedir.

### 4.2 Modül sınırları (tek deploy edilebilir backend)

`server/modules/`: `identity`, `tenants`, `catalog`, `inventory` (rate_calendar), `publication`, `search` (kazanan seçimi), `booking` (durum makinesi), `backoffice`, `voucher`, `audit`, `notifications`. Servis ayrıştırması ancak ölçülmüş bir ihtiyaç olduğunda yapılır.

### 4.3 Barındırma kararı — ÖNERİLEN — ONAY BEKLİYOR (§13, karar 9) [T7]

Sağlayıcı aşağıdaki kriterlerle seçilir: veri merkezi bölgesi (Türkiye veya AB), KVKK kapsamında yurt dışı aktarım dayanağı, PITR ve günlük yedek, bağlantı havuzu, durağan ve aktarım sırasında şifreleme, SLA, aylık maliyet, ekip işletim kapasitesi. Supabase değerlendirilirse Türkiye bölgesi bulunup bulunmadığı sağlayıcıdan doğrulanmalıdır; varsayılmamalıdır. Supabase Auth/RLS'e iş kuralı bırakılmaz; yetki backend'de doğrulanır.

## 5. Mantıksal veri modeli (v1.0)

Tüm tablolarda UUID birincil anahtar (olay tablolarında `bigserial`), `created_at`, `updated_at`; değiştirilebilir ana kayıtlarda `version` (optimistic concurrency).

### 5.1 Kiracı ve kimlik [D2, D4]

- `tenants(id, type CHECK IN ('platform','master','sub'), parent_tenant_id, name, active)` — ana acente / alt acente hiyerarşisi.
- `users(id, tenant_id, email, password_hash, role, active, token_version)`; `UNIQUE (lower(email))`.
- Roller (Şartname §3): `system_admin` → platform; `master_agency` ve `back_office` → master; `sub_agency` → sub. **Rol ↔ kiracı tipi kısıtı DB'de** (trigger veya bileşik FK).
- `login_attempts(email_lower, ip, success, at)`, `password_reset_tokens(token_hash, user_id, expires_at, used_at)`.
- Eski tarayıcı uygulamasındaki SHA-256 parola özetleri taşınmaz; kullanıcılar ilk girişte parola sıfırlar. Demo kullanıcılar üretim verisine girmez.

### 5.2 Katalog ve envanter [A2, D1]

- `properties(id, owner_tenant_id → master, name, location, category, description, amenities, operational_notes, status CHECK IN ('draft','active','inactive'))`
- `property_media(id, property_id, document_id, sort)`
- `room_types(id, property_id, name, max_adults, max_children, active)`
- `rate_plans(id, room_type_id, property_id, board_code, currency, cancellation_class, payment_class, active)` — `(room_type_id, property_id)` bileşik FK ile otel tutarlılığı.
- `rate_calendar(id, rate_plan_id, stay_date, net_price NUMERIC(19,4), allotment, sold DEFAULT 0, stop_sale, min_stay, CHECK (sold BETWEEN 0 AND allotment), UNIQUE (rate_plan_id, stay_date))`

### 5.3 Acenteye yayın ve satış fiyatı [A2, D1]

- `agency_publications(id, rate_plan_id, sub_tenant_id → sub, active, valid_from, valid_to, UNIQUE (rate_plan_id, sub_tenant_id))` — otel, fiyat planından türetilir; ayrı `hotel_id` tutulmaz (tutarsızlık riski).
- `agency_price_rules(id, publication_id, date_from, date_to, rule_type CHECK IN ('percent','fixed','override'), value NUMERIC(19,4))` — model ÖNERİLEN — ONAY BEKLİYOR (§13, karar 4).
- Yayını yalnızca otelin sahibi ana acente yapabilir; hedef aktif bir alt acente olmalıdır.

### 5.4 Arama ve kazanan (kilitsiz)

- `search_sessions(id, sub_tenant_id, params JSONB, created_at)`
- `fx_rates(id, base, quote, rate NUMERIC(19,8), source, valid_at)`
- `winner_quotes(id, search_id, sub_tenant_id, equivalence_key, rate_plan_id, publication_id, nights JSONB, normalized_total NUMERIC(19,4), currency, fx_rate_id NOT NULL, expires_at, UNIQUE (search_id, equivalence_key))` — yalnız kazanan saklanır.
- `search_audit_events(id, search_id, reason_code, detail JSONB)` — yalnız yetkili iç rol okur.

Arama hiçbir envanter tablosuna yazmaz.

### 5.5 Rezervasyon ve voucher

- `bookings(id, booking_no (sequence), sub_tenant_id, property_id, rate_plan_id, winner_quote_id, status CHECK IN ('draft','pending','confirmed','rejected','cancelled'), reason_code, check_in, check_out, rooms, total NUMERIC(19,4), currency, operation_notes, agency_reference, version)`
- `booking_nights(booking_id, rate_calendar_id, stay_date, rooms, net_price, sell_price, PRIMARY KEY (booking_id, stay_date))` — fiyat snapshot'ı ve iptalde kontenjan iadesinin kaynağı.
- `booking_guests(id, booking_id, room_index, first_name, last_name, guest_type, age)` — kapsam ÖNERİLEN — ONAY BEKLİYOR (§13, karar 7'ye bağlı KVKK değerlendirmesi).
- `booking_events(id, booking_id, from_status, to_status, reason_code, actor_id, note, at)` — append-only.
- `booking_notes(id, booking_id, author_id, body, visibility, at)`
- `vouchers(id, booking_id, version, document_id, sha256, generated_by, generated_at)`

### 5.6 Operasyon, audit ve idempotency

- `idempotency_records(tenant_id, operation, key, request_hash, status, response JSONB, PRIMARY KEY (tenant_id, operation, key))` — aynı anahtar farklı içerikle gelirse 422 [D6].
- `documents(id, storage_key, sha256, content_type, owner_tenant_id, access_policy)`
- `outbox_events(id, type, payload JSONB, created_at, processed_at, attempts)`
- `audit_events(id, actor_id, actor_tenant_id, target_tenant_id, action, resource_type, resource_id, before JSONB, after JSONB, ip, user_agent, request_id, at)` — runtime DB rolüne yalnız `INSERT` yetkisi.

### 5.7 Temel veri kuralları ve indeksler

- Tüm zamanlar UTC saklanır; otelin yerel saat dilimi ve iptal son tarihi ayrıca tutulur.
- Para tutarları `NUMERIC(19,4)`, para birimi ISO 4217.
- Karşılaştırma yalnız eşdeğerlik anahtarı aynı tekliflerde yapılır (§2.3).
- `winner_quotes` üzerinde arama + eşdeğerlik anahtarı başına tek kazanan.
- `idempotency_records` üzerinde kiracı + işlem + anahtar benzersiz.
- Kiracı verilerinde kiracı id'si içeren bileşik indeksler ve FK kontrolleri.
- `rate_calendar (rate_plan_id, stay_date)`, `bookings (sub_tenant_id, created_at)`, `bookings (property_id, status)`, `booking_events (booking_id)`, `agency_publications (sub_tenant_id)` indeksleri.
- Misafir kişisel verisi şifreleme, erişim logu ve saklama süresi politikasıyla korunur.
- Derinlemesine savunma: alt acente tablolarında RLS; uygulama rolü `BYPASSRLS` değildir.

## 6. Kritik iş akışları

### 6.1 Yönetici: ürünü satışa açma

1. Ana acente otel, oda tipi ve fiyat planı oluşturur (`draft`).
2. Tarih aralığına toplu net fiyat ve kontenjan girer (`rate_calendar`). Kontenjan satılmış miktarın altına indirilemez (409).
3. Oteli `active` yapar.
4. Fiyat planını seçili alt acentelere yayınlar ve acente fiyat kuralını tanımlar.

### 6.2 Arama → kazanan (kilitsiz)

1. API kimliği, rolü (`sub_agency`) ve arama parametrelerini doğrular.
2. Acenteye yayınlanmış fiyat planları arasında uygunluk kontrolü yapılır (§2.3).
3. Normalize toplam hesaplanır; eşdeğerlik anahtarı başına tek en düşük kazanan seçilir.
4. Yalnız kazananlar `winner_quotes`'a yazılır ve döndürülür.
5. Envantere hiçbir yazma yapılmaz; hold/lock/booking oluşmaz.

### 6.3 Rezervasyon talebi → Back Office kararı

1. Alt acente yalnız `winnerQuoteId` ve `Idempotency-Key` ile talep oluşturur (`draft`); misafir bilgilerini girer ve gönderir (`pending`). Quote süresi dolmuşsa veya başka acenteye aitse 409/404. **Kontenjan bu aşamada düşmez** (ÖNERİLEN — ONAY BEKLİYOR, §13 karar 1).
2. Talep Back Office kuyruğuna düşer.
3. Back Office **onaylarsa**, tek transaction içinde (§6.5): yalnız kazanan fiyat planının fiyatı ve kontenjanı yeniden doğrulanır; tüm geceler atomik koşullu düşümle güncellenir; başarılıysa `confirmed`.
4. Herhangi bir gece başarısızsa transaction geri alınır; rezervasyon `rejected` + `NO_AVAILABILITY` veya `PRICE_CHANGED` olur; **başka seçenek denenmez**; acenteye yeni arama yapması bildirilir.
5. Back Office **reddederse**: `rejected` + `OPERATOR_REJECTED`.
6. Onaylanan rezervasyon için voucher üretilebilir.

### 6.4 Durum makinesi

```
Taslak (draft) ──gönder──▶ Beklemede (pending) ──Back Office onay──▶ [recheck + atomik düşüm]
                                  │                                     ├─ başarılı ─▶ Onaylandı (confirmed) ──▶ voucher
                                  │                                     └─ başarısız ─▶ Reddedildi (rejected; NO_AVAILABILITY | PRICE_CHANGED)
                                  ├──Back Office ret──▶ Reddedildi (rejected; OPERATOR_REJECTED)
                                  └──iptal──▶ İptal edildi (cancelled)
Taslak ──iptal──▶ İptal edildi
Onaylandı ──iptal (politikaya göre)──▶ İptal edildi  [aynı transaction'da booking_nights üzerinden kontenjan iadesi]
```

`HOLD`, `HELD`, `LOCKED`, `OPTION` durumları yoktur. Kim hangi geçişi yapabilir: ÖNERİLEN — ONAY BEKLİYOR (§13, karar 7). Her geçiş `booking_events` ve `audit_events`'e kullanıcı, zaman ve sebep koduyla yazılır.

v1 sonrasında tedarikçi entegrasyonu eklenirse `SUPPLIER_PENDING` ve `UNKNOWN_OUTCOME_RECONCILIATION` ara durumları `pending → confirmed` arasına girer; v1 durumları değişmez.

### 6.5 Onay işleminin SQL taslağı (açık kilit yok)

```sql
BEGIN;
UPDATE bookings SET status = 'confirmed', version = version + 1
 WHERE id = :id AND status = 'pending' AND version = :v;            -- 0 satır → 409 (eşzamanlı karar)
-- her gece için, tarih sırasıyla:
UPDATE rate_calendar SET sold = sold + :rooms
 WHERE rate_plan_id = :rp AND stay_date = :d
   AND NOT stop_sale AND allotment - sold >= :rooms
   AND net_price = :quoted_net;                                      -- fiyat değiştiyse 0 satır
-- herhangi biri 0 satır → ROLLBACK; ayrı transaction'da status='rejected' + reason_code
INSERT INTO booking_nights ...; INSERT INTO booking_events ...;
INSERT INTO audit_events ...;  INSERT INTO outbox_events ...;       -- e-posta, voucher işi
COMMIT;
```

### 6.6 İptal

Onaylanmış rezervasyon iptalinde aynı transaction'da `booking_nights` satırlarındaki her gece için `UPDATE rate_calendar SET sold = sold - :rooms` yapılır. Reddedilen veya taslak/beklemede iptal edilen rezervasyon zaten kontenjan tüketmediği için iade gerekmez (karar 1 onaylanırsa).

### 6.7 Voucher

Yalnız `confirmed` rezervasyon için sunucuda PDF üretilir: rezervasyon numarası, otel, tarihler, oda/pansiyon, misafir, operasyon notları; BED4BOOK logosu kaynak dosyadan (renk kodları tahmin edilmez); kişisel ad, telefon veya unvan yok. Erişim: rezervasyonu yapan alt acente, otelin ana acentesi, Back Office, sistem yöneticisi. Üretim ve indirme audit'e yazılır; dosya nesne depolamada, DB'de anahtar ve SHA-256.

## 7. API taslağı (v1.0) [A7]

Taban yol `/api/v1`. OpenAPI şeması ve sözleşme testleri zorunludur.

| Alan | Uç noktalar | Rol |
|---|---|---|
| Kimlik | `POST /auth/login`, `POST /auth/logout`, `POST /auth/password-reset`, `GET /me` | herkes |
| Yönetim | acente ve kullanıcı CRUD, rol, pasifleştirme | `system_admin` |
| Katalog | otel CRUD + durum; oda tipi; fiyat planı; `PUT /rate-plans/{id}/calendar` (tarih aralığı toplu) | `master_agency` |
| Yayın | `POST/PATCH/DELETE /publications`, fiyat kuralları | `master_agency` |
| Arama | `POST /searches` → yalnız kazananlar; `GET /quotes/{id}` | `sub_agency` |
| Rezervasyon | `POST /bookings` (`winnerQuoteId`, `Idempotency-Key`), `POST /bookings/{id}/submit`, `POST /bookings/{id}/cancel`, `GET /bookings`, `GET /bookings/{id}` | `sub_agency` |
| Back Office | `GET /backoffice/bookings` (filtre, sayfalama), `GET /backoffice/bookings/{id}`, `POST /backoffice/bookings/{id}/approve`, `/reject`, `/cancel`, notlar, geçmiş | `back_office`, `master_agency`, `system_admin` |
| Voucher | `GET /bookings/{id}/voucher` (yalnız `confirmed`) | yetkili roller |
| Sağlık | `GET /health`, `GET /ready` (DB kontrollü) | — |

Yanıtlarda kaybeden teklifler, başka acentelerin fiyatları veya müşteri bilgileri yer almaz.

## 8. Kurulum ve ortam yapısı

### 8.1 Ortamlar

- **Local:** Docker Compose ile API + PostgreSQL 16 + sahte SMTP.
- **CI:** GitHub Actions, PostgreSQL 16 servisi, temiz veritabanında migration + testler.
- **Staging:** üretime benzer; pilot test verisi; üretim verisi kopyalanmaz.
- **Production:** yönetilen PostgreSQL, nesne depolama, TLS, rate limit, izleme, yedekleme.

Ortamların veritabanları ve anahtarları birbirinden ayrıdır.

### 8.2 Repo yapısı

Mevcut yapı korunur; ikinci bir backend dizini açılmaz.

```
server/
  app.ts, db.ts, security.ts
  modules/            # identity, tenants, catalog, inventory, publication, search, booking, backoffice, voucher, audit, notifications
  migrations/         # 001_initial.sql, 002_*.sql ... (sürümlü SQL)
  worker.ts           # outbox işleyici (e-posta, voucher)
  cli/                # admin oluşturma, migration
src/                  # mevcut tarayıcı uygulaması (kademeli olarak API'ye bağlanır)
tests/
  server/             # birim + PostgreSQL entegrasyon testleri
  *.js                # mevcut tarayıcı testleri
infra/
  docker/             # compose ve container tanımları
  runbooks/           # yedek/geri yükleme, dağıtım, rollback
.github/workflows/
```

### 8.3 İlk kurulum adımları [K1-K7]

1. Node.js 22 LTS; `package-lock.json` commit edilir; CI ve dağıtımda `npm ci`. *(Bu revizyonda yapıldı.)*
2. `.gitignore` (`node_modules/`, `dist-server/`, `.env*`) ve `.env.example`. *(Bu revizyonda yapıldı.)*
3. CI: PostgreSQL 16 servisi, temiz DB'de migration, `npm run build:server`, `npm run test:server`. *(Bu revizyonda yapıldı.)*
4. Migration çalıştırıcı ve `schema_migrations` tablosu (`npm run db:migrate`).
5. İki DB rolü: migration rolü (DDL) ve runtime rolü (yalnız gerekli DML; audit tablosunda yalnız `INSERT`).
6. İlk sistem yöneticisini oluşturan CLI (`npm run admin:create`; parola stdin'den alınır, loglanmaz).
7. Pilot seed: örnek oteller ve test acenteleri (demo verisi değil).
8. Eski tarayıcı testlerinin depo içi fikstürle CI'ye alınması (`tests/unit.js` depo dışı yol bağımlılığı).
9. Branch protection: CI yeşil olmadan merge yok.
10. Staging: yönetilen PostgreSQL, günlük yedek + PITR, TLS (Caddy/Nginx), HTTP→HTTPS, SMTP + SPF/DKIM/DMARC, DNS.
11. Logo kaynak dosyasından renk kodlarının çıkarılması (Şartname §10).
12. Yedekten geri yükleme runbook'u ve ilk tatbikat (`infra/runbooks/restore.md`): yedekten ayrı bir veritabanına geri yükleme, satır sayısı ve kontrol toplamı karşılaştırması.
13. Production dağıtımı: GitHub environment koruması ile manuel onay; rollback adımı (önceki imaj + geriye uyumlu migration kuralı).

## 9. Güvenlik ve veri koruma

- Kiracı izolasyonu backend'de zorunludur; istemci filtreleri güvenlik mekanizması değildir.
- Her API çağrısında kimlik + rol + kiracı + nesne sahipliği kontrolü.
- DB uygulama kullanıcısı en az yetkiyle çalışır; migration hesabı runtime'da kullanılmaz.
- Sırlar ortam değişkeni veya secret manager'da; loglarda token, parola, gereksiz kişisel veri bulunmaz.
- Parametreli SQL; şema tabanlı girdi doğrulama; çıktı kodlama; CSRF ve CORS politikası (yalnız `https://www.bed4book.com`).
- Giriş için IP + e-posta bazlı hız sınırı ve geçici kilit; sabit süreli yanıt; başarılı/başarısız giriş audit'e yazılır.
- Sistem yöneticisine MFA; oturum süresi; çıkış ve parola değişiminde oturum iptali (`token_version`).
- TLS, durağan şifreleme, yedek şifrelemesi, düzenli geri yükleme testi.
- Audit kayıtları değiştirilemez (append-only).
- KVKK ve gerekiyorsa GDPR: veri envanteri, amaç, saklama süresi, silme/anonimleştirme ve veri sahibi talepleri hukuk/uyum değerlendirmesiyle netleştirilir.

Güvenlik kabul listesi OWASP ASVS 5.0.0 ile eşleştirilir; CI/CD hattı ayrı bir saldırı yüzeyi olarak korunur.

## 10. Aşamalı uygulama yol haritası [A4]

Her adımın kapanış şartı: kendi testlerinin gerçek PostgreSQL ile CI'de yeşil olması (Şartname §8).

| Sıra | İş paketi | Bağımlılık | Teslimat ve kabul kriteri | Şartname bağı |
|---|---|---|---|---|
| 0 | Ürün kararları (§13) | — | Yazılı onay | §10 açık kararlar |
| 1 | Repo hijyeni ve CI | 0 | Lockfile, `npm ci`, PostgreSQL'li CI, eski testler CI'de, branch protection. *(Kısmen tamamlandı: lockfile, .gitignore, .env.example, PostgreSQL'li CI, entegrasyon testleri.)* | §8 |
| 2 | Platform temeli | 1 | PR #2 inceleme bulguları (pasif acente, rol↔tip, girdi doğrulama, idempotency yarışı, hata yönetimi, HTTP sertleştirme); migration çalıştırıcı; admin CLI; oturum iptali. Kabul: iki kiracı negatif erişim testleri | Kabul 3, 5 |
| 3 | Katalog + takvim | 2 | Otel/oda/fiyat planı/`rate_calendar`. Kabul: yönetici manuel otel, oda, fiyat ve kontenjan ekler | Kabul 1 |
| 4 | Yayın + acente fiyat kuralı | 3 | Kabul: seçili alt acente oteli doğru fiyatla görür, diğeri görmez | Kabul 1, 3 |
| 5 | Arama + tek kazanan | 4 | Kabul: eşdeğerler içinde yalnız en düşük döner; eşdeğer olmayanlar karışmaz; kaybedenler yanıtta ve logda yok; arama sonrası `sold` değişmez | Kural 1-3 |
| 6 | Rezervasyon + Back Office + durum makinesi | 5 | Kabul: N paralel onay / kontenjan K → tam K onay, aşım 0; onay başarısızsa başka seçeneğe geçiş yok; idempotency paralel testi; iptalde iade | Kabul 2, 4; Kural 4-6 |
| 7 | Voucher | 6 | Kabul: onaylı rezervasyon için doğru içerikli PDF; yetkisiz erişim reddi | Kabul 2 |
| 8 | UI bağlantısı | 3-7 | Mevcut ekranlar use-case API'lerine; tarayıcıda iş verisi kalıcı tutulmaz. Kabul: Proje Şartnamesi §3 kullanıcı yolculukları | §5 |
| 9 | Güvenlik ve işletim | 2-8 | Rate limit, MFA, audit tamlığı, TLS, SMTP, yedek + geri yükleme tatbikatı, temel yük testi | Kabul 5, canlı kapıları |
| 10 | Pilot ve canlı | 9 | 5-10 acente pilot; kritik hata yok; imzalı canlı kontrol listesi | Proje §7 |

### 10.1 v1 sonrası (ayrı kapsam, maliyet ve onayla)

- Tedarikçi API/XML adaptörleri (çok kaynaklı arama, tedarikçide recheck, asenkron onay ve mutabakat); Redis/kuyruk ihtiyacı burada değerlendirilir.
- Ödeme, sanal POS, banka, e-fatura, muhasebe ve ledger.
- Rebooking ve RateRelay: üç mevcut uygulamadan (u002e, u0030, u008) biri seçilir, diğerleri kaldırılır; denetim raporu R-2…R-8 düzeltilir.
- React/Vite arayüz geçişi, OpenTelemetry, gelişmiş raporlama, ölçekleme.

**v1 sırasında Rebooking/RateRelay için tek iş:** üç uygulamanın da v1 paketinde etkin olmadığını doğrulayan test.

## 11. Test ve kabul matrisi

| Test | Beklenen sonuç | Durum |
|---|---|---|
| Arama envantere dokunmaz | Arama sonrası rezervasyon kaydı yok, `sold`/`reserved` değişmedi | Mevcut uç noktada otomatik test var |
| Eş zamanlı kontenjan | N paralel istek, kontenjan K → tam K başarılı, aşım 0 | Rezervasyon oluşturma için otomatik test var (20 istek / 5 kontenjan); onay akışı için eklenecek |
| Kısmi düşüm yok | Bir gece yetersizse hiçbir gece düşmez | Otomatik test var |
| Tek kazanan | Eşdeğer teklifler içinde normalize toplamı en düşük tek kayıt döner | Eklenecek (adım 5) |
| Eşdeğer olmayan teklifler | Aynı karşılaştırma havuzuna girmez (ör. farklı pansiyon) | Eklenecek |
| Eşit fiyat | Tie-break deterministik | Eklenecek |
| Kur eksik | Teklif elenir | Eklenecek |
| Alternatif gizliliği | Yanıt/export/log yalnız kazananı içerir | Eklenecek |
| Onayda yeniden doğrulama | Yalnız kazanan fiyat planı kontrol edilir | Eklenecek (adım 6) |
| Onay başarısız | Başka fiyat planı/otel denenmez; `rejected` + sebep | Eklenecek |
| Onaysız kesinleşme yok | Back Office onayı olmadan `confirmed` oluşmaz | Eklenecek |
| İptal iadesi | Onaylı rezervasyon iptalinde kontenjan geri gelir | Eklenecek |
| Idempotency | Aynı anahtar → tek rezervasyon; paralel aynı anahtar → 500 yok; farklı içerik → 422 | Tekrar oynatma testi var; paralel ve 422 eklenecek |
| Kiracı izolasyonu | Alt acente A, B'nin fiyat, müşteri ve rezervasyonunu ID tahminiyle dahi göremez | Rezervasyon için test var; diğer uç noktalar eklenecek |
| Voucher | Yalnız onaylı rezervasyon; doğru içerik; yetkisiz erişim reddi | Eklenecek (adım 7) |
| Rebooking/RateRelay devre dışı | v1 paketinde bu modüller çağrılamaz | Eklenecek |
| Yedekten geri yükleme | Tatbikatla kanıtlanır | Eklenecek (adım 9) |
| Hata kayıtları | Hiçbir geçersiz girdi 500 dönmez; hatalar request-id ile loglanır | Eklenecek |

## 12. Riskler

1. **Ürün kararlarının gecikmesi:** §13 kararları alınmadan adım 3-6 kesinleşemez.
2. **Fiyat semantiği:** net/brüt, vergi, acente kuralı, kur kaynağı ve yuvarlama tek iş kuralı olarak onaylanmalı.
3. **Eşdeğerlik sözlüğü:** oda, pansiyon, iptal ve ödeme sınıfları için yönetilebilir sabit listeler gerekir.
4. **Veri göçü:** demo seed ve localStorage verisi üretime otomatik taşınmaz; taşınacak veri için eşleme ve sayım/tutar mutabakatı yapılır.
5. **UI geçişi:** mevcut ekranlar tarayıcı içi iş kuralına bağlı; use-case API'lerine geçiş tahmin edilenden uzun sürebilir.
6. **Hosting:** bölge, KVKK, SLA, bütçe ve operasyon sorumlusu belirlenmeden sağlayıcı kesinleşmez.
7. **Yük:** gerçek trafik profili olmadan kapasite taahhüdü verilmez; staging ölçümüyle belirlenir.

## 13. Açık kararlar — proje sahibi onayı gerekli

| # | Karar | Önerilen | Etkilenen bölümler |
|---|---|---|---|
| 1 | Kontenjan ne zaman düşer? | Yalnız Back Office onayı anında | §2.2, §6.3, §6.6 |
| 2 | Backend | PR #2 temeli (Express 5) ile devam | §4.1, §8.2 |
| 3 | Eşdeğerlik anahtarı iptal ve ödeme koşulunu içerir mi? | Evet (iade edilebilir ve edilemez fiyat iki ayrı kazanan olur) | §2.3, §5.4 |
| 4 | Fiyat modeli | Net fiyat + acente kuralı (yüzde/sabit/override) | §5.3 |
| 5 | Karşılaştırma para birimi ve kur kaynağı | EUR; kur kaynağı ve zamanı kayıtlı; kur yoksa teklif elenir | §2.3, §5.4 |
| 6 | Eşit fiyatta kazanan | Kaynak id, sonra fiyat planı id (deterministik) | §2.3 |
| 7 | Onay sonrası iptal yetkisi; alt acentenin iptal hakkı; misafir verisi kapsamı | İş sahibi belirler (Şartname §10) | §5.5, §6.4, §6.6 |
| 8 | Back Office kapsamı | Ana acente bazlı | §5.1 |
| 9 | PostgreSQL sürümü ve hosting bölgesi | PostgreSQL 16; TR veya AB bölgesi, KVKK değerlendirmesiyle | §4.1, §4.3 |
| 10 | Rebooking/RateRelay | v1 dışı; ileride tek uygulama seçilir | §10.1 |

## 14. Kaynaklar

### Depo içi
- `docs/BED4BOOK_Teknik_Sartname.md`, `docs/BED4BOOK_Proje_Sartnamesi.md`, `docs/IMPLEMENTATION_PLAN_BED4BOOK_V1.md`
- `docs/reviews/CLAUDE_ARCHITECTURE_ROADMAP_REVIEW.md`, `docs/reviews/CLAUDE_V1_TECHNICAL_REVIEW.md`
- `docs/Cloude_Book4me_Arama_Motoru_Teknik_Sartname.md`, `docs/BED4BOOK_MASTER_TECHNICAL_SPEC.md`
- `server/`, `tests/server/`, `src/core/store.js`, `src/domain/search.js`, `src/domain/booking.js`, `src/domain/pricing.js`, `src/updates/u0030-bed4book-core.js`, `src/updates/u008-bed4book-core.js`

### Harici
- PostgreSQL: https://www.postgresql.org/docs/
- OWASP ASVS 5.0.0: https://asvs.owasp.org/
- OWASP CI/CD Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/CI_CD_Security_Cheat_Sheet.html
- OWASP Database Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Database_Security_Cheat_Sheet.html
