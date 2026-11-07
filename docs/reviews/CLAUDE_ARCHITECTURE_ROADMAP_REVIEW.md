# Book4me / BED4BOOK — Teknik Mimari ve Veri Yol Haritası Bağımsız Denetimi (Claude)

- **Denetlenen belge:** `docs/TECHNICAL_ARCHITECTURE_DATA_ROADMAP_TR.md` (dal `docs/technical-architecture-roadmap-2026-11`, commit `a454179`, 328 satır)
- **Denetim talimatı:** `docs/CLAUDE_TECHNICAL_REVIEW_PROMPT_TR.md` (aynı dal, commit `4f7ed1e`)
- **Karşılaştırılan kod:** `main` (`81e3f8a`) — tarayıcı uygulaması; `feature/bed4book-v1-server-foundation` (`9d2f73a`, PR #2) — sunucu temeli
- **Bağlayıcı kapsam kaynakları:** `docs/BED4BOOK_Teknik_Sartname.md`, `docs/BED4BOOK_Proje_Sartnamesi.md`, `docs/IMPLEMENTATION_PLAN_BED4BOOK_V1.md`
- **Ürün kuralları (korunacak):** arama/rezervasyon tutma-kilitleme yok · yalnızca en düşük fiyat değerlendirilir · kazanan dışında alternatif kullanılmaz
- **Tarih:** 7 Kasım 2026

> Bu görevde kod değiştirilmedi. Satır numaraları, aksi belirtilmedikçe ilgili dalda dosyanın satırıdır. Roadmap satırları `RM:<satır>` olarak gösterilmiştir.

---

## 0. Genel karar

**REJECT — bu haliyle v1.0 yol haritası olarak kabul edilmemeli. §2 (değişmez kurallar), §5.6 (veri kuralları) ve §9 (güvenlik) bölümleri korunarak revize edilmeli.**

Gerekçe tek cümlede: Belge, **çok tedarikçili API/XML meta-arama** ürününü (tedarikçiye fan-out, kazanan teklif, tedarikçide recheck, tedarikçi onayı) tarif ediyor; oysa bağlayıcı BED4BOOK v1.0 şartnamesi **manuel envanter + alt acenteye yayın + Back Office onayı + PDF voucher** ürününü tanımlıyor ve tedarikçi API/XML'i açıkça kapsam dışı bırakıyor. Sonuç olarak v1'in zorunlu modüllerinin (acenteye yayın, günlük fiyat/kontenjan, Back Office onay/ret, voucher) tablosu, iş akışı ve fazı yok; buna karşılık kapsam dışı olanlar (tedarikçi adaptörleri, Rebooking/RateRelay, ödeme/ledger, Redis kuyruk) fazların merkezinde.

### En kritik 5 bulgu

| # | Bulgu | Durum |
|---|---|---|
| 1 | Hedef iş akışı v1 şartnamesiyle çelişiyor: Back Office onay/ret, Taslak/Reddedildi durumları, voucher, acenteye yayın yok (RM:155-179, RM:257-270) | FAIL — Kritik |
| 2 | Kilit yok kuralı ile v1 Kabul Kriteri 4 (kontenjan aşımı engellenir) arasındaki ilişki tanımlanmamış; test matrisinde kontenjan aşımı testi yok (RM:22, RM:272-289) | FAIL — Kritik |
| 3 | Belge, aynı depoda açık olan PR #2'yi (Express + `pg` + SQL migration, `server/`) hiç anmıyor ve paralel ikinci bir backend (NestJS + Prisma, `apps/api`) öneriyor; PostgreSQL 18 şartnamedeki 16 ile çelişiyor (RM:68-71, RM:206-236) | FAIL — Kritik |
| 4 | Mevcut kodda "tek en düşük kazanan" kuralı doğru uygulanmıyor: arama eşdeğerliğinde pansiyon yok, otel kimliği isim metni, bilinmeyen para birimi kur=1 sayılıyor; u008 kazanan seçimi eşdeğerliği hiç karşılaştırmıyor; u008 testi **pahalı teklifin kazanmasını bekliyor ve başarısız** | FAIL — Yüksek |
| 5 | Mevcut durum tespiti eksik: depoda **üç** paralel Rebooking/RateRelay uygulaması (u002e, u0030, u008) aynı pakete derleniyor, belge yalnız ikisini biliyor; u0030'da onaylanmış yeni rezervasyondan sonra oluşan hata "failed safely" olarak raporlanıyor (çift rezervasyon riski) | FAIL — Yüksek |

---

## 1. Yöntem ve çalıştırılan komutlar

1. Roadmap ve talimat dosyası satır satır okundu; bağlayıcı v1 şartnameleri ve önceki PR #2 incelemesiyle (`docs/reviews/CLAUDE_V1_TECHNICAL_REVIEW.md`) karşılaştırıldı.
2. Talimatta listelenen dosyaların varlığı kontrol edildi — hepsi `main`'de mevcut. Ek olarak talimatta olmayan `src/updates/u0030-bed4book-core.js` bulundu.
3. `hold|lock|inFlight|recheck|fallback|winner|tutma` vb. terimler `src/` genelinde arandı.
4. Testler çalıştırıldı (`main` çalışma ağacında, Node 22.23):

| Komut | Sonuç |
|---|---|
| `node tests/unit.js` | **26 geçti, 4 kaldı** — 4'ü de depo dışı fikstür yolu yüzünden: `ENOENT /home/user/paket/book4me-ai-devir-paketi/ornek-veriler/...` |
| `node tests/u008-bed4book.js` | **BAŞARISIZ** — `AssertionError: 'bad' !== 'good'` (`tests/u008-bed4book.js:11`) |
| `node tests/bed4book.js` | Geçti — `BED4BOOK tests passed` |
| `node tests/ui-flow.js` ve diğer tarayıcı testleri | **Çalıştırılmadı — NOT VERIFIED** |
| PR #2 sunucu testleri ve PostgreSQL 16 entegrasyon denemeleri | Önceki raporda (`CLAUDE_V1_TECHNICAL_REVIEW.md` §7) |

Çalıştırılmayan hiçbir test PASS sayılmamıştır. `main` dalında bu testleri koşan bir CI işi yoktur.

---

## 2. Ürün kuralı kabul matrisi

Kurallar roadmap §2 ve talimat dosyasından alınmıştır. "Mevcut kod" sütunu `main` tarayıcı kodu + PR #2 sunucu kodunun gerçek davranışıdır; "Roadmap" sütunu belgenin kuralı uygulanabilir biçimde tarif edip etmediğidir.

| # | Kural | Roadmap | Mevcut kod | Kanıt |
|---|---|---|---|---|
| R1 | Arama sırasında hold/lock/geçici booking yok | PASS (RM:22, RM:166, RM:179) | **PASS** — arama fonksiyonları salt okunur | `src/domain/search.js:10-41` yalnızca okuma; `o.hold` envanter değil **ön ödeme teminat blokajı** (`src/domain/accounting.js:49-57`) |
| R1b | Rezervasyon talebi kontenjanı ne zaman düşer? (kural ile Kabul 4'ün kesişimi) | **FAIL** — tanımsız | **ÇELİŞKİLİ** — eski kod yalnız "Onaylı"yı sayar (`search.js:10`); PR #2 talep anında (`pending`) düşer (`server/app.ts:143-151`) | Bkz. §4.1 — ürün sahibi kararı gerekli |
| R2 | Eşdeğer geçerli teklifler arasında tek en düşük normalize toplam | PASS (RM:23, RM:162-164) | **FAIL** | `search.js:15` otel kimliği = `ad|şehir` metni; `search.js:19` eşdeğerlikte pansiyon yok; `pricing.js:6` bilinmeyen kur → 1; `u008:25-37` eşdeğerlik karşılaştırılmıyor |
| R3 | Kazanan dışında alternatif/fallback gösterilmez | PASS (RM:24, RM:165, RM:193) | **NOT VERIFIED / kısmen** | Otel sonucunda oda tipi başına iade edilebilir **ve** iade edilemez fiyat birlikte dönüyor (`search.js:34-35`) — iptal koşulu eşdeğerlik anahtarındaysa uyumlu, değilse alternatif sayılır (karar gerekli). UI/export/log taraması yapılmadı |
| R4 | Yalnız kazanan yeniden doğrulanır | PASS (RM:25, RM:172) | **FAIL** (ana akış) | `src/domain/booking.js:24-36` `BK.place` hiçbir recheck yapmıyor; fiyat istemciden gelen `it.total`. u0030 PASS (`u0030:84`), u008 recheck yok (`u008:61-64`) |
| R5 | Recheck başarısızsa ikinci teklife otomatik geçiş yok | PASS (RM:26, RM:173) | **PASS** (fallback kodu bulunamadı) | u0030:85-87, u008:65-66, RateRelay `close` (`u008:146-149`) ikinciye geçmiyor |
| R6 | Onay/referans gelmeden CONFIRMED yok | PASS (RM:27, RM:175) | **FAIL** (tarayıcı), **PASS** (PR #2) | `booking.js:32` `status: "Onaylı"` doğrudan; `booking.js:35` `booking.confirmed` olayı; `integrations.js:123` API Out `status: "confirmed"`. PR #2 `pending` oluşturur |

**v1 için kural eşlemesi (önemli):** v1'de tedarikçi API'si yoktur; "tedarikçi" otelin ana acentesi/Back Office'tir. Dolayısıyla R4 = "Back Office onayı anında yalnız seçilen kazanan fiyat planının fiyat ve kontenjanı yeniden doğrulanır", R6 = "Back Office onayı + atomik kontenjan düşümü olmadan Onaylandı yok". Roadmap bu eşlemeyi yapmadığı için kurallar v1'de uygulanamaz durumda.

---

## 3. Bulgu tablosu

Öncelik: Kritik / Yüksek / Orta / Düşük. Durum: PASS / FAIL / NOT VERIFIED.

### 3.1 Roadmap belgesi — iş akışı ve kapsam

| ID | Durum | Öncelik | Konum | Teknik gerekçe | Önerilen düzeltme |
|---|---|---|---|---|---|
| A1 | FAIL | **Kritik** | RM:155-179, RM:257-270 | Hedef akış `Search → Winner → supplier recheck → supplier create → CONFIRMED`. v1 Şartname §4.3: "operasyon kuyruğuna düşmesi, yetkili onayı veya reddi ve voucher üretimi"; durumlar "Taslak, Beklemede, Onaylandı, Reddedildi, İptal edildi". Belgede Back Office, onay/ret, Taslak, Reddedildi, voucher yok. | §5.3'teki birleşik durum makinesine geçin: v1 durumları + makine okunur sebep kodları; tedarikçi durumları ayrı faz. |
| A2 | FAIL | **Kritik** | RM:99-108, RM:110-118 | v1'in çekirdeği olan **acente bazlı yayın** (Şartname §4.2) ve **tarih bazlı fiyat/kontenjan** (§4.1) için tablo yok. `contracts/contract_seasons` var ama günlük allotment/stop-sale/acente satış fiyatı yok. `supplier_offers` API teklif modeline göre tasarlanmış. | §5.4 düzeltilmiş şemadaki `rate_calendar`, `agency_publications`, `agency_price_rules`, `booking_nights`, `vouchers` tablolarını ekleyin. |
| A3 | FAIL | **Kritik** | RM:22, RM:272-289 | "Kilit yok" kuralı yazılmış; ancak v1 Kabul 4 "aynı anda gelen taleplerde kontenjan tutarsızlığı ve mükerrer rezervasyon engellenir" diyor. Belge bunun **kilitsiz** nasıl sağlanacağını söylemiyor ve test matrisinde **kontenjan aşımı/eşzamanlılık testi yok** (yalnız idempotency var). | §4.1 kararı + §5.3 atomik koşullu düşüm; test matrisine "N paralel onay, kontenjan K → tam K onay, aşım 0" ekleyin. |
| A4 | FAIL | **Kritik** | RM:257-270 | Faz 2 "Katalog ve tedarikçi sandbox", Faz 3-4 tedarikçi search/booking, Faz 5 ödeme/ledger. v1 Proje Şartnamesi §6 aşamaları (manuel envanter → yayın → rezervasyon/Back Office/voucher → test) karşılığı yok. Voucher hiçbir fazda yok. | §6'daki düzeltilmiş geliştirme sırasını kullanın. Tedarikçi/ödeme/Rebooking fazlarını "v1 sonrası" bölümüne taşıyın. |
| A5 | FAIL | Yüksek | RM:28, RM:79, RM:288, RM:298 | Rebooking/RateRelay modül listesinde, test matrisinde ve risklerde v1 çekirdeğiyle aynı düzlemde. Proje sahibi onayı olmadan v1 kapsamında değil. | Ayrı "Faz 2+ — onay bekliyor" bölümü; v1 build'inde bu modüllerin devre dışı olduğunu doğrulayan test. |
| A6 | FAIL | Orta | RM:1, RM:6 | Başlıkta "Book4me / BED4BOOK"; Şartname §1: yeni dokümanlarda yalnız BED4BOOK. | Başlık ve metinlerde yalnız BED4BOOK. |
| A7 | FAIL | Orta | RM:185-191 | API taslağında v1 uç noktaları yok: yönetim (otel/oda/fiyat planı/takvim/yayın/kullanıcı), Back Office (kuyruk, onay, ret, not, geçmiş), voucher, acentenin kendi rezervasyonları. | §5.6 düzeltilmiş API listesini ekleyin. |
| A8 | PASS | — | RM:18-28 | Kural metinleri net, uygulanabilir ve kaynak şartnamelerle (`Cloude_Book4me_Arama_Motoru_Teknik_Sartname.md:23-37`, `BED4BOOK_MASTER_TECHNICAL_SPEC.md:16, 68-71`) tutarlı. | Korunmalı. |
| A9 | PASS | — | RM:143-153, RM:242-255 | Veri kuralları (UTC, `NUMERIC`, ISO 4217, append-only audit, PII şifreleme) ve güvenlik ilkeleri doğru. | Korunmalı; v1 tablolarına uygulanmalı. |

### 3.2 Roadmap belgesi — teknoloji seçimleri

| ID | Durum | Öncelik | Konum | Teknik gerekçe | Önerilen düzeltme |
|---|---|---|---|---|---|
| T1 | FAIL | **Kritik** | RM:68, RM:206-229, RM:235 | PR #2 zaten Node 22 + TypeScript + Express 5 + `pg` + SQL migration ile `server/` altında backend kuruyor. Belge bunu yok sayıp NestJS + `apps/api` öneriyor → iki paralel backend, iki şema, iki rol modeli. | Tek backend kararı. Öneri: PR #2 temelinde devam (Express 5 veya Fastify), `server/modules/*` ile modüler monolit. NestJS ancak ekip tercihiyse ve PR #2 bilinçli olarak terk edilirse. |
| T2 | FAIL | Yüksek | RM:70, RM:234 | PostgreSQL 18; Teknik Şartname §6 "PostgreSQL 16 için yönetilen veri tabanı". Sürüm sapması onaysız. | v1: PostgreSQL 16 (veya sağlayıcının desteklediği 16+ sürüm, yazılı onayla). CI ve üretim aynı ana sürümde. |
| T3 | FAIL | Yüksek | RM:71, RM:236 | Prisma: kilitsiz koşullu güncelleme (`UPDATE … WHERE allotment-reserved >= n`), kısmi unique indeks, RLS, `CHECK`, trigger gibi bu projenin kritik değişmezleri ham SQL gerektiriyor; belge de bunu kabul ediyor → iki şema kaynağı. PR #2 zaten SQL migration kullanıyor. | Sürümlü ham SQL migration (`node-pg-migrate` veya eşdeğeri) + tip güvenliği için isteğe bağlı Kysely/`pg-typed`. Prisma v1'de kullanılmasın. |
| T4 | FAIL | Orta | RM:72, RM:199 | Redis + BullMQ: v1'de iş yükü (voucher PDF, e-posta) düşük, pilot 5-10 acente (Proje §10). Ek servis = ek yedek/izleme/güvenlik yüzeyi. | v1: PostgreSQL üzerinde outbox + iş tablosu (veya `pg-boss`). Redis yalnız ölçülen ihtiyaçla (Faz 2+ tedarikçi fan-out). |
| T5 | FAIL | Orta | RM:67, RM:210 | React + Vite yeni ekranlar: v1 süresi 4-6 hafta (Proje §6); Şartname §5 "mevcut kullanılabilir ekranlar korunarak". | v1: mevcut ekranlar API'ye bağlanır. React geçişi v1 sonrası. |
| T6 | FAIL | Yüksek | RM:38; `src/core/store.js:2-3, 30-38` | Belge ServerAdapter'ı "geçiş hedefi" olarak sunuyor. Gerçekte store tüm veri tabanını tek JSON belge olarak **senkron** okuyup yazıyor (`store.js:44-62`) ve iş kuralları tarayıcıda çalışıyor. "Yalnız adaptör değişir" yaklaşımı mümkün değil (çok kullanıcılı, yetkili, transaction'lı API ile uyumsuz). | UI'yı **use-case bazlı** API çağrılarına geçirin (ekran → `/api/...`), ServerAdapter'ı genel belge depolama olarak kullanmayın. Bu geçişi ayrı faz ve kabul testiyle planlayın. |
| T7 | NOT VERIFIED | Orta | RM:83-85 | Supabase: veri yerleşimi (Şartname §10 "Türkiye/AB" açık karar), KVKK yurt dışı aktarım, PITR/yedek ve maliyet doğrulanmadı. Bilgim dahilinde Supabase'in Türkiye bölgesi yok; sağlayıcıdan doğrulanmalı. | Karar kriteri listesi: bölge, KVKK aktarım dayanağı, PITR, bağlantı havuzu, şifreleme, SLA, aylık maliyet. Supabase Auth/RLS'e iş kuralı bırakılmasın (belge de söylüyor — PASS). |
| T8 | PASS (koşullu) | Düşük | RM:73-77 | S3 uyumlu depolama, Docker, GitHub Actions, OWASP ASVS uygun. OIDC + MFA, OpenTelemetry v1 için erken ama zararsız. | v1: HttpOnly çerezli sunucu oturumu + sistem yöneticisine MFA; `pino` JSON log + hata izleme; OTel sonra. |

### 3.3 Roadmap belgesi — veri modeli

| ID | Durum | Öncelik | Konum | Teknik gerekçe | Önerilen düzeltme |
|---|---|---|---|---|---|
| D1 | FAIL | **Kritik** | RM:87-153 | Eksik v1 tabloları: `agency_publications` (acenteye açma), `agency_price_rules` (acente satış fiyatı/markup), `rate_calendar` (tarih × fiyat planı: fiyat, allotment, satılan, stop-sale), `booking_nights` (gecelik fiyat snapshot'ı + kontenjan iadesi için), `vouchers`, `booking_notes`. | §5.4 DDL taslağı. |
| D2 | FAIL | Yüksek | RM:93-96 | `tenants` tek kök; v1'de **ana acente / alt acente** hiyerarşisi ve 4 sabit rol (Şartname §3) var. Rol ↔ kiracı tipi kısıtı (PR #2 incelemesi Y5) belgede yok. | `tenants.type IN ('platform','master','sub')`, `parent_tenant_id`; rol-kiracı tipi kısıtı DB'de (trigger veya bileşik FK). |
| D3 | FAIL | Yüksek | RM:114-118, RM:148 | `winner_quotes` "search + equivalence key başına tek kazanan" — doğru; ancak **eşdeğerlik anahtarının bileşenleri ve tie-break** tanımlı değil. Eşit fiyatta kazanan belirsiz = deterministik değil. | `equivalence_key` = hash(canonical_property, room_type, board, occupancy, check_in, check_out, cancellation_policy_class, payment_terms_class, market). Tie-break: `normalized_total ASC, tenant/supplier id ASC, rate_plan id ASC`. |
| D4 | FAIL | Orta | RM:89, RM:124-133 | Oturum/kimlik tabloları eksik: `user_sessions` veya `token_version`, `login_attempts`, `password_reset_tokens`. Eski SHA-256 hash'lerin göç stratejisi yok. | Tablolar + "eski hash taşınmaz, ilk girişte zorunlu sıfırlama" kuralı (bkz. S1). |
| D5 | FAIL | Orta | RM:146, RM:116 | `fx_rates` var ama karşılaştırma para birimi, kur zamanı bağlama (quote anındaki kur) ve eksik kur davranışı (hata mı?) tanımsız. Mevcut kodda eksik kur sessizce 1 sayılıyor (`pricing.js:6`). | Kur yoksa teklif **uygunsuz** sayılır (karşılaştırmaya girmez); `winner_quotes.fx_rate_id` zorunlu. |
| D6 | PASS | — | RM:132, RM:149, RM:151 | `idempotency_records` tenant + operation + key unique; supplier + supplier_ref unique. | Korunmalı; `request_hash` sütunu eklenmeli (PR #2 O2). |

### 3.4 Roadmap belgesi — kurulum adımları

| ID | Durum | Öncelik | Konum | Eksik |
|---|---|---|---|---|
| K1 | FAIL | Yüksek | RM:231-240 | Lockfile ve `npm ci` (madde 1 "belirle" diyor, mevcut PR #2'de lockfile yok); `.gitignore`; `.env.example`. |
| K2 | FAIL | Yüksek | RM:236 | Migration çalıştırıcı ve `schema_migrations`; DB rolleri ayrımı (migrator vs. runtime — RM:246'da ilke var, kurulum adımı yok); ilk sistem yöneticisini oluşturan CLI; pilot (demo olmayan) seed. |
| K3 | FAIL | Yüksek | RM:239 | Yedekten geri yükleme tatbikatının komut/runbook düzeyinde tanımı (Kabul 5 ve canlı kapısı zorunlu). |
| K4 | FAIL | Orta | RM:202 | DNS, TLS sonlandırma (Caddy/Nginx veya LB), HTTP→HTTPS, SMTP + SPF/DKIM/DMARC (Şartname §6), logo kaynak dosyası ve renk kodlarının çıkarılması (Şartname §10). |
| K5 | FAIL | Orta | RM:238 | CI'de DB servisiyle entegrasyon testi; mevcut tarayıcı testlerinin CI'ye alınması ve depo dışı fikstür bağımlılığının giderilmesi (`tests/unit.js` 4 hata); branch protection. |
| K6 | NOT VERIFIED | Orta | RM:297 | Eski localStorage verisinin taşınması: belge "otomatik taşınmamalı" diyor (doğru) ama taşıma/eşleme aracı ve sayım-mutabakat adımı yok. |
| K7 | FAIL | Düşük | RM:226 | `deploy-production.yml` önerisi var; onay kapısı (environment protection, manuel onay) ve rollback adımı tanımsız. |

### 3.5 Mevcut kod — arama ve tek kazanan

| ID | Durum | Öncelik | Konum | Teknik gerekçe | Önerilen düzeltme |
|---|---|---|---|---|---|
| C1 | FAIL | Yüksek | `src/domain/search.js:15` | Otel eşdeğerliği `name.toLowerCase() + "|" + city.toLowerCase()`. Yazım farkı aynı oteli ayırır; aynı adlı farklı oteller birleşir. | Canonical `property_id` + tedarikçi/ana acente alias tablosu (RM:103-104 doğru; koda uygulanmalı). |
| C2 | FAIL | Yüksek | `src/domain/search.js:19`, `:38` | Teklif eşdeğerliği yalnız oda tipi metni + kapasite. **Pansiyon (board) karşılaştırmaya girmiyor**; pansiyon filtresi grubun yalnız ilk otelinde (`G[0].board`) kontrol ediliyor. Aynı otelin BB teklifi AI teklifini "daha ucuz" diye yenebilir. | Eşdeğerlik anahtarına board, iptal ve ödeme sınıfı eklenmeli; filtre her teklif için uygulanmalı. |
| C3 | FAIL | Orta | `src/domain/pricing.js:6-7` | `PR.cv = a*(R[f]||1)/(R[to]||1)` — tanımsız para birimi kur 1 kabul ediliyor; karşılaştırma `TRY`'ye float ile. Yanlış kazanan seçilebilir. | Kur yoksa teklif uygunsuz; decimal aritmetik; kur kaynağı/zamanı kayıt. |
| C4 | FAIL | Orta | `src/domain/search.js:21` | Eşit fiyatta sıralama `Array.sort` kararlılığına ve kayıt sırasına bağlı — deterministik tie-break yok. (u008'de var: `u008:33-35`.) | D3'teki tie-break. |
| C5 | NOT VERIFIED | Orta | `src/domain/search.js:34-35` | Oda tipi başına hem iade edilebilir (`of[0]`) hem iade edilemez (`nf[0]`) en düşük fiyat dönüyor. İptal koşulu eşdeğerlik bileşeniyse bunlar iki ayrı kazanandır (uyumlu); değilse ikinci teklif alternatif sayılır. | Ürün sahibi kararı: iptal koşulu eşdeğerlik anahtarında mı? Karar testle sabitlenmeli. |
| C6 | PASS | — | `src/domain/search.js:43, 51, 62` | Transfer, tur ve uçuşta anahtar başına yalnız en ucuz tutuluyor; tedarikçi adı sonuçta yok. | Korunmalı. |
| C7 | PASS | — | `src/domain/search.js:22` | Çok odalı aramada her oda için müsait olan en ucuz teklif seçiliyor; bu arama anında müsaitlik hesabıdır, sonradan fallback değildir. | Korunmalı; booking anında ikinci teklife geçilmemeli (R5). |

### 3.6 Mevcut kod — rezervasyon

| ID | Durum | Öncelik | Konum | Teknik gerekçe | Önerilen düzeltme |
|---|---|---|---|---|---|
| B1 | FAIL | **Kritik** | `src/domain/booking.js:24-36` | `BK.place` istemciden gelen kalemi (`it.total`) doğrudan kaydediyor, **ne fiyat ne müsaitlik yeniden doğrulanıyor**, durum doğrudan `"Onaylı"`. Kontenjan aşımı ve fiyat manipülasyonuna açık. | Sunucu tarafı: quote ID → sunucu fiyatı; Back Office onayında kazanan fiyat planında recheck + atomik düşüm. |
| B2 | FAIL | Yüksek | `src/domain/integrations.js:118-124` | API Out `book` canlı modda `BK.place` çağırıp `status: "confirmed"` dönüyor — onaysız kesinleşme (R6). v1 kapsamında dışa API zaten yok. | v1'de API Out devre dışı; ileride `pending` dönmeli. |
| B3 | PASS | — | PR #2 `server/app.ts:156` | Sunucu temeli rezervasyonu `pending` oluşturuyor; Back Office kararı gerekiyor (R6 v1 eşlemesiyle uyumlu). | Korunmalı. |
| B4 | FAIL | Yüksek | PR #2 `server/app.ts:143-151` | Talep anında (`pending`) kontenjan düşüyor; Back Office kararına kadar envanter fiilen tutuluyor. Bu, "rezervasyon tutma yok" kuralının bir okumasına göre **hold** sayılabilir; eski kod ise yalnız onaylıyı sayıyor (`search.js:10`). İki kod tabanı farklı semantik uyguluyor. | §4.1 kararı. Öneri: düşüm yalnız onay anında (Seçenek B). |
| B5 | NOT VERIFIED | — | — | Gerçek tedarikçi recheck/create/timeout/reconciliation: kodda gerçek adaptör yok; mock/test adaptörü canlı bağlantı sayılmadı. | v1 kapsamı dışında; Faz 2+. |

### 3.7 Mevcut kod — Rebooking / RateRelay (v1 kapsamı dışı; yalnız risk kaydı)

| ID | Durum | Öncelik | Konum | Teknik gerekçe | Önerilen düzeltme |
|---|---|---|---|---|---|
| R-1 | FAIL | Yüksek | `tools/build.js:13`; `src/updates/u002e-rebooking.js`, `u0030-bed4book-core.js`, `u008-bed4book-core.js` | `src/updates/u*.js` dosyalarının **tamamı** pakete giriyor: üç ayrı Rebooking/RateRelay uygulaması aynı anda yüklü (`B4M.rb`, `B4M.bed4book`, `B4M.rebookingV2/rateRelay`). Roadmap (RM:42, RM:55, RM:298) yalnız u002e ve u008'i biliyor. | Tek uygulama seçilmeli; diğerleri paketten çıkarılmalı veya özellik bayrağıyla kapatılmalı; v1 build'inde hiçbiri aktif olmamalı. |
| R-2 | FAIL | Yüksek | `src/updates/u008-bed4book-core.js:25-37` | `valid()` eşdeğerlik alanlarının **varlığını** kontrol ediyor; mevcut rezervasyonla **eşitliğini** değil. `same()` tanımlı ama hiç kullanılmıyor (satır 29). Farklı otel/pansiyon teklifi "kazanan" olabilir → R2 ihlali. | `choose(offers, reservation.equivalence)` içinde `same(offer.equivalence, reservation.equivalence)` zorunlu. |
| R-3 | FAIL | Yüksek | `tests/u008-bed4book.js:7-11` | İki teklif **aynı eşdeğerlikte**; test 80'lik teklif yerine 95'lik "good"un kazanmasını bekliyor. Kod (doğru biçimde) 80'i seçtiği için test kırmızı. Test, en düşük fiyat kuralına aykırı bir beklentiyi kodluyor; CI olmadığı için fark edilmemiş. | Testi kurala göre düzeltin: ya 80'lik teklifin eşdeğerliğini farklı yapın (geçersiz olduğu için elenmeli) ya da beklentiyi 80 yapın. |
| R-4 | FAIL | Yüksek | `src/updates/u0030-bed4book-core.js:105, 118-121` | `oldAdapter.cancel` **hata fırlatırsa** (onaysız dönüş değil), yeni rezervasyon onaylı olduğu halde `catch` durumu `"failed"` yapıp "failed safely" mesajı döndürüyor → manuel mutabakat işaretlenmiyor, çift rezervasyon. | `created` onaylandıktan sonraki her hata `manual_reconciliation` olmalı. |
| R-5 | FAIL | Orta | `src/updates/u0030-bed4book-core.js:41` | Eşdeğerlikte `occupancyKey` = sıralı **misafir adları**; yetişkin/çocuk sayısı/yaşı değil. Aynı doluluk farklı adlarla eşdeğer sayılmaz, farklı doluluk aynı adlarla eşdeğer sayılır. | Doluluk anahtarı: oda başına `(adults, child_ages[])`. |
| R-6 | FAIL | Orta | `src/updates/u008-bed4book-core.js:10-23` | Idempotency süreç belleğinde (`inFlight` Map) ve **başarısız sonuçlar da kalıcı önbelleğe yazılıyor** → geçici hata aynı anahtarla bir daha denenemez. | DB unique kayıt; yalnız terminal sonuçlar önbelleğe; `in_progress` durumu. |
| R-7 | FAIL | Orta | `src/core/store.js:68`; `u008:18, 91`; `u0030:30, 65` | `scope()` kiracı haritasında olmayan koleksiyonları **tüm kiracılara görünür** sayıyor (`!f ||`). `b4mOps`, `rateRelayOpportunities`, `bed4bookRebookings`, `bed4bookAudit` haritada yok. | Sunucuda zaten kiracı filtresi zorunlu; tarayıcı tarafında da varsayılan "görünmez" olmalı. |
| R-8 | FAIL | Orta | `src/updates/u002e-rebooking.js:5-7, 52-54` | "Tutma hakkı" (right-to-match) ve risk grubu kısıtı `BED4BOOK_MASTER_TECHNICAL_SPEC.md:95` ile çelişiyor; roadmap bunu doğru tespit etmiş (RM:55) ama kaldırma planı yok. | u002e paketten çıkarılmalı. |

### 3.8 Mevcut kod — güvenlik

| ID | Durum | Öncelik | Konum | Teknik gerekçe | Önerilen düzeltme |
|---|---|---|---|---|---|
| S1 | FAIL | Yüksek | `src/core/app.js:27-28`; `src/domain/auth.js:17, 39` | Parolalar tuzlu **SHA-256** ile (hızlı özet, KDF değil); tüm demo şifresi `"book4me"`; asgari 6 karakter. Şartname §7 "güçlü, tuzlu parola özeti". | Sunucuda scrypt/argon2id (PR #2'de var). Eski hash'ler taşınmaz; tüm kullanıcılar ilk girişte sıfırlar. Demo kullanıcılar üretim verisine girmez. |
| S2 | FAIL | Orta | `src/domain/auth.js:47-56` | Geçici şifre e-posta gövdesinde ve UI mesajında açık metin. | Tek kullanımlık, süreli sıfırlama bağlantısı. |
| S3 | FAIL | Yüksek | `src/core/store.js:66-74` | Kiracı izolasyonu tarayıcıda filtre; tüm veri istemcide. Roadmap doğru tespit ediyor (RM:51, RM:244) — PASS (belge), FAIL (kod). | Sunucu tarafı yetkilendirme (PR #2 + O5 RLS önerisi). |
| S4 | PASS | — | RM:96, RM:247 | API anahtarlarının DB'de düz metin tutulmaması, secret manager. | Korunmalı. |

---

## 4. Ürün kurallarının korunarak v1'e uygulanması

### 4.1 Kilit yok + kontenjan aşımı yok: nasıl birlikte sağlanır

Kurallar çelişmiyor; ama ayrım yazılı olarak yapılmalı:

| Kavram | Kural kapsamında mı? | Açıklama |
|---|---|---|
| Arama sırasında oda/kontenjan tutma | **Yasak** | Arama hiçbir tabloya yazmaz (yalnız arama/audit kaydı). |
| Süreli geçici rezervasyon (opsiyon, hold, "15 dk sende") | **Yasak** | Hiçbir durumda yok; durum makinesinde `HOLD/HELD/LOCKED` yok. |
| `SELECT … FOR UPDATE` ile açık satır kilidi (PR #2) | Kaçınılmalı | Teknik bir kilit; kural metniyle karışmaması için kaldırılmalı. |
| Tek SQL ifadesiyle atomik koşullu düşüm | **Serbest — önerilen** | `UPDATE rate_calendar SET sold = sold + :n WHERE id = :id AND allotment - sold >= :n AND NOT stop_sale` — etkilenen satır yoksa onay reddedilir. Kalıcı tutma yok; ifade milisaniyede biter. |

**Kontenjan hangi anda düşer? — KARAR GEREKLİ (ürün sahibi).** Önerim **Seçenek B**:

- **A — Talep anında düş (PR #2'nin bugünkü davranışı):** `Beklemede` rezervasyon, Back Office karar verene kadar odayı tüketir. Bu, süresiz bir envanter tutmadır ve kuralın ruhuyla çelişir.
- **B — Yalnız onay anında düş (önerilen):** `Beklemede` talep kontenjanı tüketmez. Back Office "Onayla" dediğinde aynı transaction'da: (1) yalnız seçilmiş kazanan fiyat planı için fiyat ve kontenjan yeniden doğrulanır (R4), (2) tüm geceler için atomik koşullu düşüm yapılır, (3) biri başarısızsa tümü geri alınır, durum `Reddedildi` + sebep `NO_AVAILABILITY` veya `PRICE_CHANGED` olur, **başka fiyat planına/otele geçilmez** (R5), acenteye "yeni arama yapın" bildirilir, (4) başarılıysa `Onaylandı` + voucher üretilebilir (R6). Eski tarayıcı kodu da yalnız onaylıyı sayıyor (`search.js:10`), yani semantik tutarlı olur.

B'nin ticari bedeli: Beklemede talep onaylanana kadar başka acente aynı odayı alabilir. Bu, kilit yok kuralının doğal sonucudur ve açıkça kabul edilmelidir.

### 4.2 Tek en düşük kazanan — v1 anlamı

v1'de bir alt acente için aynı eşdeğerlik anahtarında birden fazla teklif şu durumlarda oluşur: aynı otel birden fazla ana acente tarafından yayınlanmışsa, aynı oda+pansiyon için birden fazla fiyat planı acenteye açıksa. Kural:

1. Uygunluk: yayın aktif, otel/oda/fiyat planı aktif, tüm geceler için fiyat var, `allotment - sold >= rooms`, stop-sale yok, pazar/milliyet uygun, kapasite uygun, kur mevcut.
2. Normalize toplam = Σ(gecelik net) → acente fiyat kuralı → karşılaştırma para birimine kur (quote anındaki kur kaydıyla), `NUMERIC`.
3. Eşdeğerlik anahtarı başına **tek** kazanan; deterministik tie-break.
4. API yalnız kazananı döndürür; kaybeden tekliflerin fiyatı, kaynağı, sayısı yanıtta, export'ta, logda yer almaz (iç denetim için `search_audit_events` yalnız yetkili rolde).
5. Rezervasyon talebi yalnız `winner_quote_id` ile yapılır; quote süresi dolmuşsa veya sahibi başka acente ise 409/404.

### 4.3 Alternatif kullanılmaz — test edilebilir tanım

- Arama yanıtında eşdeğerlik anahtarı başına tam 1 kayıt.
- Booking talebi kazanan dışındaki bir teklifi referans alamaz (quote tablosunda yalnız kazanan saklanır).
- Onay başarısız olduğunda sistem hiçbir başka fiyat planı, oda, otel veya ana acente denemez; bunu doğrulayan negatif test.

---

## 5. Düzeltilmiş teknik mimari (v1.0)

### 5.1 Bileşenler

```
[Tarayıcı: mevcut BED4BOOK ekranları (responsive)]
        │  HTTPS, HttpOnly oturum çerezi, CSRF token
        ▼
[Ters proxy: Caddy/Nginx — TLS, HSTS, rate limit]
        ▼
[BED4BOOK API — Node.js 22 LTS + TypeScript, Express 5 (PR #2 temeli), modüler monolit]
   modules/ identity · tenants · catalog · inventory(rate_calendar) · publication
            search(winner) · booking(state machine) · backoffice · voucher · audit · notifications
   ├─ zod doğrulama, pino JSON log + request-id, hata kodu sözlüğü
   └─ worker (aynı kod tabanı, ayrı süreç): outbox → e-posta, voucher PDF
        ▼                                   ▼
[PostgreSQL 16 (yönetilen, TR/AB bölgesi)]   [S3 uyumlu nesne depolama: görsel, voucher PDF]
   - SQL migration (sürümlü), migrator ≠ runtime rolü
   - günlük yedek + PITR, düzenli geri yükleme tatbikatı
[SMTP (SPF/DKIM/DMARC)]   [Hata izleme + uptime]   [GitHub Actions: npm ci, typecheck, unit, Postgres'li entegrasyon, migration, audit]
```

v1'de **yok**: Redis/BullMQ, NestJS, Prisma, React yeniden yazımı, OpenTelemetry, tedarikçi adaptörleri, ödeme/ledger, Rebooking/RateRelay. Bunlar §6'daki "v1 sonrası" fazlara aittir.

### 5.2 Kiracı ve roller

- `tenants(type: platform | master | sub, parent_tenant_id)`; roller: `system_admin` (platform), `master_agency` ve `back_office` (master), `sub_agency` (sub). Rol ↔ tip kısıtı DB'de.
- Her sorgu: kimlik + rol + kiracı + nesne sahipliği. Derinlemesine savunma için RLS (uygulama rolü `BYPASSRLS` değil).

### 5.3 Birleşik rezervasyon durum makinesi

```
Taslak (DRAFT) ──gönder──▶ Beklemede (PENDING) ──Back Office onay──▶ [aynı transaction: recheck + atomik düşüm]
                                  │                                        ├─ başarılı ─▶ Onaylandı (CONFIRMED) ──▶ voucher
                                  │                                        └─ başarısız ─▶ Reddedildi (REJECTED, reason=NO_AVAILABILITY|PRICE_CHANGED)
                                  ├──Back Office ret──▶ Reddedildi (REJECTED, reason=OPERATOR_REJECTED)
                                  └──iptal──▶ İptal edildi (CANCELLED)
Onaylandı ──iptal (politikaya göre)──▶ İptal edildi  [aynı transaction'da booking_nights üzerinden kontenjan iadesi]
```

`HOLD`, `HELD`, `LOCKED`, `OPTION` durumları yoktur. Faz 2+ tedarikçi entegrasyonunda `SUPPLIER_PENDING` ve `UNKNOWN_OUTCOME_RECONCILIATION` ara durumları `PENDING → CONFIRMED` arasına eklenir; v1 durumları değişmez.

### 5.4 Düzeltilmiş veri modeli (v1 çekirdeği — DDL taslağı)

```sql
-- kiracı ve kimlik
tenants(id uuid pk, type text check (type in ('platform','master','sub')), parent_tenant_id uuid fk, name, active, version, created_at, updated_at)
users(id, tenant_id fk, email, password_hash, role, active, token_version int, mfa_secret_ref, created_at)
  unique (lower(email));  -- rol↔tenant.type kısıtı trigger ile
login_attempts(id, email_lower, ip inet, success bool, at)
password_reset_tokens(token_hash pk, user_id fk, expires_at, used_at)

-- katalog (master sahibi)
properties(id, owner_tenant_id fk -> tenants(type='master'), name, location, category, description, status check in ('draft','active','inactive'), ...)
property_media(id, property_id fk, document_id fk, sort)
room_types(id, property_id fk, name, max_adults, max_children, active)
rate_plans(id, room_type_id fk, property_id fk, board_code, currency char(3), cancellation_class, payment_class, active)
  -- (room_type_id, property_id) bileşik FK ile otel tutarlılığı
rate_calendar(id, rate_plan_id fk, stay_date date, net_price numeric(19,4), allotment int, sold int default 0,
              stop_sale bool default false, min_stay int,
              check (sold >= 0 and sold <= allotment), unique (rate_plan_id, stay_date))

-- acenteye yayın ve satış fiyatı (agency isolation)
agency_publications(id, rate_plan_id fk, sub_tenant_id fk -> tenants(type='sub'), active, valid_from, valid_to,
                    unique (rate_plan_id, sub_tenant_id))
agency_price_rules(id, publication_id fk, date_from, date_to, rule_type check in ('percent','fixed','override'), value numeric(19,4))

-- arama ve kazanan (kilitsiz; yalnız gözlem)
search_sessions(id, sub_tenant_id, params jsonb, created_at)
winner_quotes(id, search_id fk, sub_tenant_id, equivalence_key text, rate_plan_id, publication_id,
              nights jsonb, normalized_total numeric(19,4), currency, fx_rate_id, expires_at,
              unique (search_id, equivalence_key))
search_audit_events(id, search_id, reason_code, detail jsonb)  -- yalnız yetkili iç rol

-- rezervasyon
bookings(id, booking_no (sequence), sub_tenant_id, property_id, rate_plan_id, winner_quote_id,
         status check in ('draft','pending','confirmed','rejected','cancelled'), reason_code,
         check_in, check_out, rooms, total numeric(19,4), currency, operation_notes, agency_reference, version, ...)
booking_nights(booking_id fk, rate_calendar_id fk, stay_date, rooms, net_price, sell_price, primary key (booking_id, stay_date))
booking_guests(id, booking_id fk, room_index, first_name, last_name, guest_type, age)
booking_events(id bigserial, booking_id, from_status, to_status, reason_code, actor_id, note, at)  -- append-only
booking_notes(id, booking_id, author_id, body, visibility, at)
vouchers(id, booking_id fk unique-per-version, version, document_id fk, sha256, generated_by, generated_at)
idempotency_records(tenant_id, operation, key, request_hash, status, response jsonb, primary key (tenant_id, operation, key))

-- operasyon
documents(id, storage_key, sha256, content_type, owner_tenant_id, access_policy)
outbox_events(id, type, payload jsonb, created_at, processed_at, attempts)
audit_events(id bigserial, actor_id, actor_tenant_id, target_tenant_id, action, resource_type, resource_id,
             before jsonb, after jsonb, ip inet, user_agent, request_id, at)  -- runtime rolüne yalnız INSERT
```

### 5.5 Kritik işlem — onay (kilitsiz)

```sql
BEGIN;
UPDATE bookings SET status = 'confirmed', version = version + 1
 WHERE id = :id AND status = 'pending' AND version = :v;          -- optimistic; 0 satır → 409
-- her gece için (tarih sırasıyla):
UPDATE rate_calendar SET sold = sold + :rooms
 WHERE rate_plan_id = :rp AND stay_date = :d
   AND NOT stop_sale AND allotment - sold >= :rooms
   AND net_price = :quoted_net;                                   -- fiyat değiştiyse 0 satır
-- herhangi biri 0 satır → ROLLBACK; ayrı transaction'da status='rejected', reason_code yazılır
INSERT INTO booking_nights ...; INSERT INTO booking_events ...; INSERT INTO audit_events ...; INSERT INTO outbox_events ...;
COMMIT;
```

### 5.6 v1 API listesi (düzeltilmiş)

- Kimlik: `POST /auth/login`, `POST /auth/logout`, `POST /auth/password-reset`, `GET /me`
- Yönetim (system_admin): acente ve kullanıcı CRUD
- Katalog (master_agency): otel CRUD + durum, oda tipi, fiyat planı, `PUT /rate-plans/{id}/calendar` (tarih aralığı toplu)
- Yayın (master_agency): `POST/PATCH/DELETE /publications`, fiyat kuralları
- Arama (sub_agency): `POST /searches` → yalnız kazananlar
- Rezervasyon (sub_agency): `POST /bookings` (`winnerQuoteId`, `Idempotency-Key`), `POST /bookings/{id}/submit`, `POST /bookings/{id}/cancel`, `GET /bookings`, `GET /bookings/{id}`
- Back Office: `GET /backoffice/bookings`, `POST /backoffice/bookings/{id}/approve|reject|cancel`, notlar, geçmiş
- Voucher: `GET /bookings/{id}/voucher` (yalnız `confirmed`)
- `GET /health`, `GET /ready`

---

## 6. Uygulanması gereken geliştirme sırası

Her adımın kapanış şartı: kendi testleri gerçek PostgreSQL ile CI'de yeşil (Şartname §8).

| Sıra | İş paketi | Bağımlılık | Teslimat ve kabul kriteri |
|---|---|---|---|
| 0 | **Ürün kararları** (§7) ve tek backend kararı (T1) | — | Yazılı onay: kontenjan düşüm anı (§4.1), eşdeğerlik bileşenleri, iptal politikası, fiyat modeli, PostgreSQL sürümü, hosting bölgesi |
| 1 | Repo hijyeni ve CI | 0 | lockfile, `npm ci`, `.gitignore`, `.env.example`, Postgres servisli CI, eski testlerin depo içi fikstürle CI'ye alınması, `tests/u008-bed4book.js` beklentisinin kurala göre düzeltilmesi (R-3), branch protection |
| 2 | Platform temeli (PR #2 düzeltmeleri) | 1 | PR #2 incelemesindeki K1, Y2, Y5, O1-O4, O9-O11; migration çalıştırıcı, admin CLI, oturum iptali. Kabul: iki kiracı negatif erişim testleri |
| 3 | Katalog + takvim | 2 | Otel/oda/fiyat planı/`rate_calendar` uç noktaları. Kabul: Şartname Kabul 1'in yönetici kısmı |
| 4 | Yayın + acente fiyat kuralı | 3 | Kabul: seçili alt acente oteli doğru fiyatla görür, diğeri görmez (Kabul 1, 3) |
| 5 | Arama + tek kazanan | 4 | Eşdeğerlik anahtarı, normalize toplam, tie-break, quote TTL. Kabul: eşdeğer teklifler içinde yalnız en düşük döner; eşdeğer olmayanlar karışmaz; kaybedenler yanıtta/logda yok; arama sonrası `rate_calendar.sold` değişmemiş |
| 6 | Rezervasyon + Back Office + durum makinesi | 5 | Taslak→Beklemede→Onay/Ret/İptal, kilitsiz onay (§5.5), iade. Kabul: N paralel onay / kontenjan K → tam K onay; onay başarısızsa başka plana geçiş yok; idempotency paralel testi |
| 7 | Voucher | 6 | Sunucu PDF, logo kaynak dosyasından, erişim kuralları, audit. Kabul: Kabul 2 uçtan uca |
| 8 | UI bağlantısı | 3-7 | Mevcut ekranlar use-case API'lerine; localStorage'da iş verisi yok. Kabul: Proje §3 kullanıcı yolculukları |
| 9 | Güvenlik ve işletim | 2-8 | Rate limit, MFA (sistem yöneticisi), audit tamlığı, TLS, SMTP, yedek + geri yükleme tatbikatı, temel yük testi. Kabul: Kabul 5 ve canlı kapıları |
| 10 | Pilot ve canlı | 9 | 5-10 acente pilot, kritik hata yok, imzalı canlı kontrol listesi |
| v1 sonrası | Tedarikçi API/XML adaptörleri, Redis, ödeme/ledger, tek Rebooking/RateRelay uygulaması, React geçişi, OTel | Ayrı onay | Her biri ayrı kapsam, teknik doküman ve kabul kriteri |

Eski Rebooking/RateRelay kodu için v1 sırasında yapılacak tek iş: üç uygulamanın da pakette devre dışı olduğunu doğrulamak; R-2…R-8 düzeltmeleri ilgili faz onaylanırsa ele alınır.

---

## 7. Açık ürün kararları (teknik ekip kendi başına varsaymamalı)

1. **Kontenjan düşüm anı:** onayda (önerilen, §4.1-B) mı, talepte mi?
2. **Eşdeğerlik anahtarı:** iptal koşulu ve ödeme koşulu dahil mi? (C5 — iade edilebilir/edilemez fiyatın birlikte gösterilmesi buna bağlı.)
3. **Fiyat modeli:** net + acente kuralı (yüzde/sabit) mı, acenteye özel tarihli fiyat mı?
4. **Karşılaştırma para birimi** ve kur kaynağı; kur yoksa teklifin elenmesi.
5. **Tie-break** kuralı (eşit fiyatta hangi kaynak kazanır).
6. **Onay sonrası iptal** yetkisi ve kontenjan iadesi politikası.
7. **Back Office kapsamı:** ana acente bazlı mı, platform geneli mi?
8. **Tek backend:** PR #2 (Express) devam mı, NestJS'e geçiş mi?
9. **PostgreSQL sürümü** (şartname 16) ve **hosting bölgesi** (TR/AB), KVKK aktarım değerlendirmesi.
10. **Rebooking/RateRelay:** v1 dışı olduğu teyidi ve hangi uygulamanın (u002e/u0030/u008) ileride esas alınacağı.

---

## 8. Sonuç — bu değişiklikler yapılmadan canlıya çıkılmamalı

- Roadmap, v1 şartnamesindeki iş akışı (Back Office onay/ret, voucher, acenteye yayın, günlük fiyat/kontenjan) ile yeniden yazılmalı (A1, A2, A4, D1).
- Kilitsiz kontenjan koruması tanımlanmalı ve eşzamanlılık testiyle kanıtlanmalı (A3, B4, §4.1, §5.5).
- Tek backend, tek şema, PostgreSQL sürümü kararı verilmeli (T1-T3).
- Tek en düşük kazanan kuralı eşdeğerlik anahtarı, kur ve tie-break ile deterministik uygulanmalı ve testle sabitlenmeli (C1-C5, D3, D5, R-3).
- İstemciden gelen fiyatla doğrudan "Onaylı" rezervasyon oluşturan eski akış üretimde kullanılmamalı (B1, B2).
- Eski SHA-256 parola özetleri ve demo kullanıcılar üretim verisine taşınmamalı (S1).
- Kapsam dışı Rebooking/RateRelay uygulamaları v1 paketinde etkin olmamalı (A5, R-1).
- Yedekten geri yükleme tatbikatı, TLS, rol kontrolleri ve audit kayıtları canlı kapısı öncesi kanıtlanmalı (K3, K4, Şartname §8).

---

*Bağımsız denetimdir; roadmap, önceki yapay zekâ çıktıları ve test dosyaları doğru kabul edilmeden kodla karşılaştırılmıştır. Kod değiştirilmemiştir. Ürün kuralları (kilit yok, yalnız en düşük fiyat, alternatif yok) gevşetilmemiş; yalnızca v1'e uygulanabilir ve test edilebilir hale getirilmiştir.*
