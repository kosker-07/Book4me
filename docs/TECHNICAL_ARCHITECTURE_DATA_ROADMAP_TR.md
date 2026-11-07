# BED4BOOK — Teknik Mimari, Veri Altyapısı ve Kurulum Yol Haritası

- Belge: Teknik Mimari ve Veri Yol Haritası
- Sürüm: **2.3** (2.2 + bağımsız denetim bulguları B4B-01…05)
- Tarih: 07.11.2026
- Depo: `kosker-07/Book4me`
- Bağlayıcı kapsam: `docs/BED4BOOK_Teknik_Sartname.md`, `docs/BED4BOOK_Proje_Sartnamesi.md`, `docs/IMPLEMENTATION_PLAN_BED4BOOK_V1.md`
- Denetim raporu: `docs/reviews/CLAUDE_ARCHITECTURE_ROADMAP_REVIEW.md` (madde kodları bu belgede köşeli parantezle anılır, ör. [A1])
- Durum: Tasarım + kısmi uygulama. Üretim ortamına kurulmamıştır. **"KARAR VERİLDİ"** maddeler proje sahibi tarafından onaylanmıştır; **"ÖNERİLEN — ONAY BEKLİYOR"** maddeler henüz kesin değildir (bkz. §13).

## Sürüm 2.3'te değişenler

- **B4B-01 Giriş kilidi:** başarısız denemeler üç anahtarla sayılır (15 dk): hesap + IP 5, IP 20, hesap 100. Saldırganın başka bir IP'den kurbanın e-postasıyla yaptığı denemeler kurbanı kilitlemez; hesap tek başına ancak dağıtık saldırıda (≥ 20 IP) kısıtlanır. 401/429 yanıtları hesabın var olup olmadığını göstermez (`server/login-guard.ts`).
- **B4B-02 Proxy ve IP:** `TRUST_PROXY` ile açık yapılandırma. Varsayılan `false` (`X-Forwarded-For` yok sayılır); `NODE_ENV=production` iken değer zorunlu; `true` reddedilir; hop sayısı (1–5) veya proxy adres/alt ağ listesi.
- **B4B-03 Eşdeğerlik:** `rate_plans.sales_conditions` anahtara eklendi (anahtar sırasından bağımsız). Pazar/milliyet v1 veri modelinde yok; eklenmedi, öneri olarak §13.2'de.
- **B4B-04 Idempotency:** `request_hash` alanı NULL olan eski (002 öncesi) anahtar yalnız kayıtlı rezervasyon isteğe uyuyorsa (fiyat planı, tarihler, oda, misafir adı) tekrar oynatılır ve parmak izi bağlanır; aksi halde 422 `IDEMPOTENCY_KEY_REUSED`. Hiçbir durumda ikinci rezervasyon oluşmaz. Yeni migration gerekmedi.
- **B4B-05:** §11 test dosyaları, §13.1 iptal kuralı (alt acente `draft` + `pending`), §6.3 ve §7'deki eski "henüz uygulanmadı" ifadeleri düzeltildi; §3.3 ve §11 yalnız gerçekten çalıştırılan testleri gösterir (yerel + CI 42412151072). M1–M18 mutation kontrolü (`infra/scripts/mutation-check.mjs`) ve CI `mutation` işi eklendi.

## Sürüm 2.2'de değişenler

- `003_draft_sessions_vouchers.sql`: "Taslak" durumu, oturum iptali (`token_version`), giriş denemeleri, voucher kaydı.
- Yönetim API'leri: otel durumu/düzenleme, oda, fiyat planı, tarih aralığına toplu fiyat/kontenjan, acenteye yayın (yüzde/sabit markup), acente ve kullanıcı yönetimi; ana acente yalnız kendi otellerini, Back Office ve sistem yöneticisi tüm platformu yönetir.
- Taslak → gönder akışı; taslak kontenjan tüketmez.
- BED4BOOK PDF voucher (yalnız onaylı rezervasyon; Türkçe karakter desteği; her üretim SHA-256 ile kaydedilir).
- Giriş: e-posta başına 5 / IP başına 20 başarısız denemede 15 dk kilit, pasif acente girişi reddi, sabit süreli doğrulama, çıkış ve kullanıcı/acente pasifleştirmede oturum iptali; güvenlik başlıkları; `/ready`.
- İlk sistem yöneticisi CLI'ı, yedek → geri yükleme tatbikatı (`infra/scripts/backup-restore-drill.sh`, `infra/runbooks/backup-restore.md`), temel performans testi (`infra/scripts/perf-smoke.ts`). Üçü de CI'de çalışır.

## Sürüm 2.1'de değişenler

- Proje sahibinin onayladığı kararlar kesinleştirildi (§13): net gecelik fiyat + yüzde/sabit markup (override yok); Back Office platform genelinde yetkili; iptal yetkileri; zorunlu misafir alanları.
- Back Office'i ana acente kiracısına bağlayan model ve açıklamalar düzeltildi (§5.1).
- Uygulanan kod: `server/migrations/002_v1_product_rules.sql`, arama uç noktası, imzalı quote ile rezervasyon, iptal/ret ve kontenjan iadesi, fiyat snapshot'ı, misafir doğrulaması (§3.2, §7).
- Test matrisi gerçek durumla güncellendi; yalnız çalıştırılmış testler "geçti" olarak işaretli (§11).

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

**Kontenjan hangi anda düşer? — ÖNERİLEN — ONAY BEKLİYOR (§13, karar 1).**

| | Davranış |
|---|---|
| **Mevcut (uygulanan) davranış** | Kontenjan, rezervasyon talebi oluşturulurken (`pending`) atomik koşullu düşümle azalır. Ret veya iptalde aynı transaction içinde **bir kez** iade edilir. Açık kilit yoktur. |
| **Önerilen hedef** | Kontenjan yalnızca Back Office onayı anında düşer; `pending` talep kontenjan tüketmez. Bedeli: onay bekleyen talebin odası bu sürede başka acenteye satılabilir. |

Proje sahibi karar verene kadar mevcut davranış korunur; kod sessizce değiştirilmez.

### 2.3 Tek kazananın tanımı [D3, D5]

- **Eşdeğerlik anahtarı** — uygulanan varsayılan, ÖNERİLEN — ONAY BEKLİYOR (§13, karar 3): otel id, oda id, pansiyon, iptal koşulu, ödeme koşulu (anahtar sırasından bağımsız JSON), yetişkin/çocuk sayısı ve çocuk yaşları, giriş/çıkış tarihi, oda sayısı satış koşulları (`rate_plans.sales_conditions`, anahtar sırasından bağımsız JSON; sürüm 2.3, B4B-03) (`server/pricing.ts` `equivalenceKey`). Pazar/milliyet v1 veri modelinde yoktur; anahtara eklenmemiştir. `sales_conditions` aramada uygunluk filtresi olarak **uygulanmaz**, yalnız teklifleri ayırır.
- **Uygunluk:** yayın aktif; otel, oda ve fiyat planı aktif; tüm geceler için fiyat var; her gece `allotment - sold >= oda sayısı`; stop-sale yok; pazar ve kapasite uygun; kur mevcut.
- **Normalize toplam** — KARAR VERİLDİ (fiyat modeli): oda sayısı × Σ(gecelik net fiyat + acente markup'ı). Markup yüzde (`net × (1 + değer/100)`) veya sabit (`net + değer`, oda/gece başına, fiyat planı para biriminde). Hesap tam sayı kuruş ile yapılır. Karşılaştırma EUR'ya çevrilerek yapılır (`fx_rates`). **Kuru bulunmayan teklif değerlendirme dışı kalır** (sessizce 1 kabul edilmez).
- **Tie-break** — uygulanan varsayılan, ÖNERİLEN — ONAY BEKLİYOR (§13, karar 6): `normalized_total ASC`, sonra en küçük fiyat planı id. Sonuç deterministiktir.
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
- Uygulanan düzeltmeler:
  - rezervasyon oluşturmadaki parametre hatası giderildi; sunucu kodunda açık satır kilidi (`FOR UPDATE`) yok, her gece tek ifadeli atomik koşullu düşüm;
  - `002_v1_product_rules.sql`: Back Office platform geneli, rol ↔ acente tipi kısıtı, markup modeli, `fx_rates`, misafir alanları, `booking_nights` snapshot'ı, rezervasyon numarası sequence'i, idempotency içerik özeti, indeksler;
  - salt okunur arama (`POST /api/agency/searches`), tek kazanan, imzalı quote; rezervasyon yalnız quote ile;
  - ret/iptalde kontenjanın tek kez iadesi; alt acente iptali; Back Office ve sistem yöneticisi iptali; ana acentenin iptal yetkisi yok;
  - paralel aynı idempotency anahtarında tek rezervasyon; farklı içerikle aynı anahtar 422;
  - geçersiz girdilerde 500 yerine 4xx.
- Açık eksikler: kontenjanın onay anında düşmesi (karar 1 bekliyor), ana sayfa/arayüzün API'ye bağlanması, `/api/v1` sürüm öneki, RLS (O5), audit kayıtlarında önceki/sonraki değer ve IP (O7), migration çalıştırıcı ve `schema_migrations` (O10 — CI'de sıralı `psql` uygulaması var), CORS/HTTPS/ters proxy (altyapı), Rebooking/RateRelay modüllerinin tarayıcı paketinde devre dışı bırakılması (karar 10), görsel yükleme ve nesne depolama, voucher dosyasının nesne depolamada saklanması, resmi logo dosyası ve renk kodları.

### 3.3 Test durumu

**Sürüm 2.3 (07.11.2026, commit `eb18003`).** Yerel ortamda (Node 22.23, PostgreSQL 16.15) npm kayıt defterine erişim yoktu; npm gerektiren adımlar GitHub Actions'ta çalıştırıldı: CI [42412151072](https://github.com/kosker-07/Book4me/actions/runs/42412151072) (Node 22, PostgreSQL 16).

| Komut | Sonuç (2.3) |
|---|---|
| `npm run test:server` | CI: **62/62 geçti**, 0 atlandı (45 entegrasyon + 17 birim). Yerel: 17 birim testi 17/17 geçti |
| `npm run build:server` + derlenmiş sunucu `/ready` | CI: geçti (`{"ok":true,"database":"up"}`, voucher 23.382 bayt) |
| `npm run admin:create` | CI: `D4` geçti (ilk yönetici oluşturuldu, tekrar ve kısa parola reddedildi) |
| `npm run perf:smoke` | CI: arama p95 150,2 ms (sınır 500 ms), rezervasyon p95 36,4 ms |
| Migration: boş DB, tekrar uygulama, 001 + eski veriden yükseltme | Geçti (yerel geçici küme, yalnız soket; ayrıca CI) |
| `infra/scripts/backup-restore-drill.sh` | `RESTORE DRILL PASSED`; bozulmuş kopyada `FAILED` (öz-test geçti) — yerel ve CI |
| `infra/scripts/mutation-check.mjs --dry-run` | 18 yamanın 18'i kodla tam bir kez eşleşiyor ve geri alınıyor |
| `infra/scripts/mutation-check.mjs` | CI `mutation` işi: **18/18 yakalandı**; her mutation sonrası dosyalar geri alındı (`git diff --quiet` temiz), son çalıştırma 62/62. Yerel `--unit-only`: M2, M3, M8, M10 yakalandı |
| Tarayıcı testleri (yeniden derlenmiş paket, sistem Chrome) | `ui-flow` 23/23, `u002-ui` 24/24, `u002-yama1` 20/20, `u003-dashboard` 33/33, `u005-mudahale` 59/59, `u005-ciftekran` 19/19, `u006-crystal` 26/26, `u007-pazar` 39/39, `u007c-tema` 10/10, `u008-bed4book` geçti, `bed4book` geçti |
| `u004-sade` | **Kararsız** — main 0/3, çalışma dalı 1/3 geçti; hepsi aynı adımda 30 sn zaman aşımı ("arama sonucundan tek tıkla rezervasyon ekranı"). `src/`, `tools/`, `dist/` main ile aynı; sorun dalda değil, test ile arama kutusunun yeniden çizimi arasındaki zamanlama yarışında (§F) |
| `u001-logo` | Çalışmıyor — depo dışı `/tmp/logo1.png` dosyası gerekli (fikstür depoda yok) |

**Sürüm 2.2 (07.11.2026, Node 22) — önceki çalıştırma, `77ef9dd`:**

| Komut | Sonuç |
|---|---|
| `npm run test:server` (PostgreSQL 16, `DATABASE_URL` ile) | 51/51 geçti (27 + 12 entegrasyon, 12 birim) |
| `infra/scripts/backup-restore-drill.sh` | `RESTORE DRILL PASSED`; bozulmuş kopyada başarısız (öz-test) |
| `npm run perf:smoke` | Arama p95 147 ms, rezervasyon p95 34 ms (yerel, 4 vCPU) |
| `npm run build` / `npm test` | Projede bu script'ler **yok** (`package.json`: `build:server`, `start:server`, `dev:server`, `test:server`) |
| `node tests/u008-bed4book.js` | Geçti |
| `node tests/bed4book.js` | Geçti |
| `node tests/unit.js` | 26 geçti, 4 kaldı — 4'ü depo dışı fikstür yolu (`/home/user/paket/...`) |
| Tarayıcı testleri (Playwright) | `ui-flow` 23/23, `u002-ui` 24/24, `u002-yama1` 20/20, `u003-dashboard` 33/33, `u005-mudahale` 59/59, `u005-ciftekran` 19/19, `u006-crystal` 26/26, `u007-pazar` 39/39, `u007c-tema` 10/10 geçti. `u004-sade` kararsız: değiştirilmemiş `main` dalında da 4 çalıştırmanın 2'sinde aynı 30 sn zaman aşımı (önceden var olan sorun). `u001-logo` depo dışı `/tmp/logo1.png` dosyası olmadığı için çalışmıyor |
| Not | Depodaki `dist/index.html`, `node tools/build.js` çıktısıyla aynı değil (eski derleme); tarayıcı testleri yeniden derlenmiş paketle çalıştırıldı |

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
- Roller (Şartname §3) — KARAR VERİLDİ:
  - `system_admin` ve `back_office` → **platform geneli**; hiçbir acente kiracısına bağlı değildir (`agency_id IS NULL`). Back Office tüm otelleri ve rezervasyonları görür ve yönetir.
  - `master_agency` → ana acente; yalnız kendi otelleri ve bu otellerin rezervasyonları.
  - `sub_agency` → alt acente; yalnız kendisine yayınlanan ürünler ve kendi rezervasyonları.
- **Rol ↔ kiracı kısıtı DB'de uygulandı** (`002`): `users_role_agency_scope` CHECK ve `users_role_matches_agency_type` trigger'ı. Yetki ayrıca backend'de her uç noktada kontrol edilir.
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
- Acente fiyat kuralı — KARAR VERİLDİ: `markup_type IN ('percent','fixed')`, `markup_value >= 0`. **Override modeli yoktur.** v1'de yayın kaydı üzerinde tutulur (`agency_hotel_sales.markup_type/markup_value`, `002`); 001'deki `sell_price`/`sell_currency` fiyatlamada kullanılmaz. Tarih aralıklı markup gerekirse ayrı onayla eklenir.
- Yayını yalnızca otelin sahibi ana acente yapabilir; hedef aktif bir alt acente olmalıdır.

### 5.4 Arama ve kazanan (kilitsiz)

- `search_sessions(id, sub_tenant_id, params JSONB, created_at)`
- `fx_rates(currency PK, eur_per_unit NUMERIC(18,8), source, valid_at)` — uygulandı (`002`).
- Kazanan quote — **uygulanan:** veritabanına yazılmaz. Arama, her kazanan için HMAC imzalı bir `quoteId` döndürür (acente, fiyat planı, tarihler, oda, doluluk, toplam, para birimi, 30 dk fiyat geçerliliği; `server/quotes.ts`). Quote envanter ayırmaz; yalnızca hangi fiyat planının hangi fiyatla kazandığını kanıtlar. İleride denetim için kalıcı kayıt gerekirse `winner_quotes` tablosu ayrı onayla eklenir.
- `search_audit_events(id, search_id, reason_code, detail JSONB)` — yalnız yetkili iç rol okur.

Arama hiçbir envanter tablosuna yazmaz.

### 5.5 Rezervasyon ve voucher

- `bookings(id, booking_no (sequence), sub_tenant_id, property_id, rate_plan_id, winner_quote_id, status CHECK IN ('draft','pending','confirmed','rejected','cancelled'), reason_code, check_in, check_out, rooms, total NUMERIC(19,4), currency, operation_notes, agency_reference, version)`
- `booking_nights(booking_id, rate_calendar_id, stay_date, rooms, net_price, sell_price, PRIMARY KEY (booking_id, stay_date))` — fiyat snapshot'ı ve iptalde kontenjan iadesinin kaynağı.
- Zorunlu misafir alanları — KARAR VERİLDİ: ad, soyad, yetişkin sayısı, çocuk sayısı, çocuk yaşları, e-posta, telefon, uyruk (ISO 3166-1 alfa-2), operasyon notu. Backend'de doğrulanır (`server/validation.ts`); v1'de `bookings` üzerinde sütun olarak tutulur (`002`). Oda başına çoklu misafir listesi (`booking_guests`) gerekirse ayrı onayla eklenir. Saklama süresi KVKK değerlendirmesine bağlıdır.
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
- Arama yanıtında eşdeğerlik anahtarı başına tek kazanan (`server/pricing.ts` `chooseWinners`).
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
4. Yalnız kazananlar imzalı `quoteId` ile döndürülür; veritabanına hiçbir şey yazılmaz.
5. Envantere hiçbir yazma yapılmaz; hold/lock/booking oluşmaz.

### 6.3 Rezervasyon talebi → Back Office kararı

1. Alt acente yalnız arama sonucundaki imzalı `quoteId`, zorunlu misafir alanları ve `Idempotency-Key` ile talep oluşturur (`pending`). Quote süresi dolmuşsa 409, sahte ise 400, başka acenteye aitse 404. Yalnız quote'taki kazanan fiyat planının fiyatı ve kontenjanı yeniden doğrulanır; fiyat değiştiyse 409 `PRICE_CHANGED`, kontenjan yoksa 409 `ALLOTMENT_UNAVAILABLE`; başka teklif denenmez. **Mevcut davranış:** kontenjan bu aşamada düşer; hedef davranış §2.2 / §13 karar 1'de onay bekliyor. `draft: true` ile taslak oluşturulabilir (003); taslak kontenjan tüketmez, `submit` ile `pending` olur.
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

`HOLD`, `HELD`, `LOCKED`, `OPTION` durumları yoktur.

Geçiş yetkileri — KARAR VERİLDİ (iptal), uygulandı:

| Geçiş | Yetkili | Uygulama |
|---|---|---|
| `pending → approved / rejected` | Back Office, sistem yöneticisi (platform geneli); ana acente (yalnız kendi otelleri) | `PATCH /api/backoffice/bookings/{id}/status` |
| `pending → cancelled` | Alt acente (yalnız kendi oluşturduğu), Back Office, sistem yöneticisi | `POST /api/agency/bookings/{id}/cancel`, `PATCH …/status` |
| `approved → cancelled` | **Yalnız** Back Office ve sistem yöneticisi | `PATCH …/status` |
| Herhangi bir iptal | Ana acente **yetkisizdir** (403) | — |

Her geçiş tek bir koşullu `UPDATE … WHERE status = <beklenen>` ile yapılır; bu sayede aynı rezervasyon iki kez iptal edilemez ve kontenjan yalnız bir kez iade edilir. Geçişler `booking_status_history` ve `audit_logs`'a kullanıcı, zaman ve not ile yazılır.

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

Mevcut davranışta (talep anında düşüm) `pending` veya `approved` rezervasyonun ret/iptalinde aynı transaction içinde `booking_nights` snapshot'ındaki her gece için kontenjan iade edilir (`002` öncesi oluşturulmuş rezervasyonlarda tarih aralığından). Hedef davranış (karar 1) onaylanırsa yalnız `approved` rezervasyonun iptali iade gerektirir.

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
| Arama | `POST /searches` → yalnız kazananlar ve imzalı `quoteId` | `sub_agency` |
| Rezervasyon | `POST /bookings` (`quoteId`, misafir alanları, `Idempotency-Key`), `POST /bookings/{id}/cancel`, `GET /bookings`, `GET /bookings/{id}`; `POST /bookings/{id}/submit` (taslak gönderimi; uygulandı) | `sub_agency` |
| Back Office | `GET /backoffice/bookings`, `GET /backoffice/bookings/{id}`, `GET /backoffice/hotels`, `PATCH /backoffice/bookings/{id}/status`; filtre/sayfalama, notlar (henüz yok) | `back_office`, `system_admin` (platform geneli); `master_agency` (yalnız kendi otelleri, iptal hariç) |

**Bugün uygulanmış uç noktalar** (taban yol şu an `/api`; `/api/v1`'e geçiş henüz yapılmadı):
- Kimlik: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me`; `GET /health`, `GET /ready`.
- Yönetim (system_admin): `POST /api/admin/agencies`, `PATCH /api/admin/agencies/{id}`, `POST /api/admin/users`, `PATCH /api/admin/users/{id}`.
- Katalog (master_agency kendi otelleri; back_office ve system_admin tümü): `POST /api/admin/hotels`, `GET/PATCH /api/admin/hotels/{id}`, `POST /api/admin/hotels/{id}/rooms`, `PATCH /api/admin/rooms/{id}`, `POST /api/admin/rooms/{id}/rate-plans`, `PATCH /api/admin/rate-plans/{id}`, `GET/PUT /api/admin/rate-plans/{id}/calendar`, `POST /api/admin/publications`, `PATCH /api/admin/publications/{id}`.
- Alt acente: `GET /api/agency/hotels`, `POST /api/agency/searches`, `POST /api/agency/bookings` (`draft: true` ile taslak), `POST /api/agency/bookings/{id}/submit`, `GET /api/agency/bookings`, `GET /api/agency/bookings/{id}`, `POST /api/agency/bookings/{id}/cancel`, `GET /api/agency/bookings/{id}/voucher`.
- Back Office: `GET /api/backoffice/bookings`, `GET /api/backoffice/bookings/{id}`, `GET /api/backoffice/hotels`, `PATCH /api/backoffice/bookings/{id}/status`, `GET /api/backoffice/bookings/{id}/voucher`.

**Sözleşme değişikliği:** `POST /api/agency/bookings` artık `ratePlanId` yerine arama sonucundaki `quoteId`'yi ve zorunlu misafir alanlarını ister. Gerekçe: yalnız kazanan teklif rezerve edilebilmeli (Kural 2-4). Bu uç noktayı kullanan bir istemci henüz yoktu (UI API'ye bağlı değil).
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
4. Migration çalıştırıcı ve `schema_migrations` tablosu (`npm run db:migrate`). *(Yapılmadı; şimdilik migration'lar sıralı ve tekrar çalıştırılabilir yazılıyor, CI `psql` ile uyguluyor.)*
5. İki DB rolü: migration rolü (DDL) ve runtime rolü (yalnız gerekli DML; audit tablosunda yalnız `INSERT`).
6. İlk sistem yöneticisini oluşturan CLI (`npm run admin:create`; parola stdin'den alınır, loglanmaz). *(Yapıldı: `server/cli/create-admin.ts`.)*
7. Pilot seed: örnek oteller ve test acenteleri (demo verisi değil).
8. Eski tarayıcı testlerinin depo içi fikstürle CI'ye alınması (`tests/unit.js` depo dışı yol bağımlılığı).
9. Branch protection: CI yeşil olmadan merge yok.
10. Staging: yönetilen PostgreSQL, günlük yedek + PITR, TLS (Caddy/Nginx), HTTP→HTTPS, SMTP + SPF/DKIM/DMARC, DNS.
11. Logo kaynak dosyasından renk kodlarının çıkarılması (Şartname §10).
12. Yedekten geri yükleme runbook'u ve tatbikatı: `infra/runbooks/backup-restore.md`, `infra/scripts/backup-restore-drill.sh` (ayrı veritabanına geri yükleme, satır sayısı ve içerik özeti karşılaştırması, öz-test). *(Yapıldı; CI'de çalışıyor. Üretimde günlük yedek hosting kararına bağlı.)*
13. Production dağıtımı: GitHub environment koruması ile manuel onay; rollback adımı (önceki imaj + geriye uyumlu migration kuralı).

## 9. Güvenlik ve veri koruma

- Kiracı izolasyonu backend'de zorunludur; istemci filtreleri güvenlik mekanizması değildir.
- Her API çağrısında kimlik + rol + kiracı + nesne sahipliği kontrolü.
- DB uygulama kullanıcısı en az yetkiyle çalışır; migration hesabı runtime'da kullanılmaz.
- Sırlar ortam değişkeni veya secret manager'da; loglarda token, parola, gereksiz kişisel veri bulunmaz.
- Parametreli SQL; şema tabanlı girdi doğrulama; çıktı kodlama; CSRF ve CORS politikası (yalnız `https://www.bed4book.com`).
- Giriş için hesap + IP (5), IP (20) ve hesap (100) bazlı hız sınırı, 15 dk; sabit süreli yanıt; hesabın varlığı yanıttan anlaşılmaz; başarılı/başarısız her deneme `login_attempts` tablosuna yazılır. İstemci IP'si yalnız `TRUST_PROXY` ile güvenilen proxy'den alınır.
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

Durum sütunu yalnız gerçekten çalıştırılmış testleri "Geçti" olarak gösterir. Testlerin bulunduğu dosyalar:

- `tests/server/booking.integration.test.ts` — PostgreSQL 16, `01`–`19` (arama, kontenjan, idempotency, yetki, iptal, fiyat, sızıntı, doğrulama)
- `tests/server/v1-flows.integration.test.ts` — PostgreSQL 16, `A1`–`A3`, `B1`–`B2`, `C1`–`C3`, `D1`–`D4` (yalnız API ile uçtan uca akışlar, taslak, yönetim yetkisi, giriş güvenliği, CLI)
- `tests/server/rules.test.ts` — birim (fiyat, kazanan, doğrulama, quote, statik kilit taraması)
- `tests/server/security.test.ts` — birim (parola, oturum, giriş sınırı politikası, `TRUST_PROXY`)

**Sürüm 2.3 notu:** Bütün satırlar `eb18003` üzerinde CI [42412151072](https://github.com/kosker-07/Book4me/actions/runs/42412151072) ile yeniden çalıştırıldı (62/62). M1–M18 mutation kontrolü aynı çalıştırmada 18/18 yakalandı.

| Test | Beklenen sonuç | Durum |
|---|---|---|
| Arama envantere dokunmaz | Arama sonrası tüm tabloların satır sayısı ve `inventory_daily` içeriği aynı | **Geçti** — `01` |
| Otel listesi envantere dokunmaz | Aynı | **Geçti** — `01b` |
| Eksik envanter satırı | 409, değişiklik yok | **Geçti** — `02` |
| Eş zamanlı kontenjan | 20 paralel istek / kontenjan 5 → tam 5 başarılı, aşım 0 | **Geçti** — `03` (talep anında düşüm için) |
| Kısmi düşüm yok | Sonraki gece başarısızsa önceki geceler geri alınır | **Geçti** — `04` |
| Paralel aynı idempotency anahtarı | Tek rezervasyon, 500 yok | **Geçti** — `05` |
| Aynı anahtar farklı içerik | 422 | **Geçti** — `05b` |
| Eski anahtar (`request_hash` NULL) | Uyan tekrar aynı yanıtı döner ve parmak izini bağlar; farklı içerik 422; ikinci rezervasyon yok; yanıtsız eski anahtar 422 | **Geçti** — `05c`, `05d` |
| Başka acentenin rezervasyonuna erişim | 404 | **Geçti** — `06` |
| Başka acentenin rezervasyonunu iptal | 404, durum ve kontenjan değişmez | **Geçti** — `07` |
| Ana acente iptali | 403 | **Geçti** — `08` |
| Back Office platform geneli | Tüm oteller ve tüm ana acentelerin rezervasyonları; `agencyId = null` | **Geçti** — `09` |
| Platform yetkisi olmayan kullanıcı | Ana acente yalnız kendi otelleri; alt acente Back Office uç noktalarında 403 | **Geçti** — `10` |
| Onaylı rezervasyon iptali | Back Office ve sistem yöneticisi iptal edebilir; kontenjan iade | **Geçti** — `11` |
| Alt acente onaylı rezervasyonu iptal edemez | 409 | **Geçti** — `11b` |
| İptal/ret tek iade | Tekrar iptal 409; paralel çift iptal tek iade, tek geçmiş kaydı | **Geçti** — `12` |
| En düşük fiyat | Eşdeğerler içinde tek ve en düşük sonuç | **Geçti** — `13`, birim testleri |
| Eşit fiyat | Deterministik (en küçük fiyat planı id) | **Geçti** — `13b`, birim testi |
| Kazanan başarısızsa ikinci teklif yok | 409; diğer teklifin kontenjanı ve rezervasyon yok | **Geçti** — `14` |
| Fiyat değiştiyse | 409 `PRICE_CHANGED`, geçiş yok | **Geçti** — `14b` |
| Eşdeğerlik | Farklı pansiyondaki ucuz teklif kazananın yerini almaz | **Geçti** — `15`, birim testi |
| Satış koşulları (B4B-03) | Farklı `sales_conditions` ayrı grup; anahtar sırası grubu bölmez; koşullar yanıtta yok | **Geçti** — `15c`, birim testi |
| Kur eksik | Teklif değerlendirme dışı; kur eklenince dahil | **Geçti** — `15b`, birim testi |
| Rakip bilgisi sızmaz | Yanıtta kaybeden fiyatı, fiyat planı/acente id, net fiyat, markup yok; acenteler birbirinin fiyatını görmez | **Geçti** — `16` |
| Başka acentenin quote'u | 404 | **Geçti** — `16b` |
| Zorunlu misafir alanları | Her biri eksik/geçersizken 400 ve alan adı | **Geçti** — `17`, birim testi |
| Doluluk quote ile uyumlu | 409 | **Geçti** — `17b` |
| Fiyat snapshot'ı | Sonradan fiyat ve markup değişse de rezervasyon tutarı ve gecelik fiyatlar aynı | **Geçti** — `18` |
| Geçersiz girdi | 500 yok; 400/404 | **Geçti** — `19` |
| Kodda açık kilit/hold durumu yok | `server/` ve 002+ migration'larda `FOR UPDATE`, advisory lock, `HOLD/LOCKED` yok | **Geçti** — birim testi (statik tarama) |
| Mutation kontrolü M1–M18 | Her bilinen hata beklenen testi kırmızıya çevirir; kaynak dosyalar geri alınır | **Geçti** — `infra/scripts/mutation-check.mjs`, CI `mutation` işi (18/18) |
| Migration: boş DB | 001 + 002 + 003 hatasız | **Geçti** — yerel (2.3, PostgreSQL 16.15) + CI adımı |
| Migration: tekrar uygulama | 002 ve 003 ikinci kez hatasız | **Geçti** — yerel (2.3) + CI adımı |
| Migration: mevcut veriyle yükseltme | Eski rezervasyon ve eski idempotency anahtarı korunur, back_office acenteden ayrılır, kısıtlar çalışır | **Geçti** — `tests/server/migrations/legacy_upgrade_checks.sql`, yerel (2.3) + CI adımı |
| Kabul 1 (API ile): otel/oda/fiyat/kontenjan → yalnız seçili alt acente doğru fiyatı görür | Taslak otel satılmaz; aktif olunca yalnız yayın yapılan acente 230.00 görür | **Geçti** — `A1` |
| Kabul 2 (API ile): rezervasyon → Back Office → onay → voucher | Kuyruk, detay, onay, PDF; `pdftotext` ile içerik doğrulaması | **Geçti** — `A2` |
| Voucher yetkisi | Başka acente/ana acente 404, alt acente Back Office ucunda 403, onaysız 409 | **Geçti** — `A3` |
| Taslak kontenjan tüketmez; gönderimde bir kez düşer | — | **Geçti** — `B1` |
| Taslak iptali iade yapmaz; başarısız gönderim taslağı bozmaz; fiyat değiştiyse 409 | — | **Geçti** — `B2` |
| Yönetim yetkisi | Ana acente yalnız kendi otelleri (diğerleri 404), alt acente 403, Back Office tümü | **Geçti** — `C1` |
| Yönetim kuralları | Yayın hedefi aktif alt acente; override yok; kontenjan rezerve edilenin altına inmez; otel sahibi ana acente; rol ↔ acente tipi | **Geçti** — `C2` |
| Pasifleştirme aramadan düşürür | Yayın, fiyat planı, otel | **Geçti** — `C3` |
| Giriş kilidi | Aynı IP'den 5 hatalı denemeden sonra doğru parolayla da 429 | **Geçti** — `D1` |
| Hesap kilitleme saldırısı | Başka IP'den 5 hata kurbanı kilitlemez; 100 hesap hatasında 429; pencere dışı hatalar sayılmaz | **Geçti** — `D1b`, birim testi |
| Hesap varlığı sızmaz | Var olan / olmayan e-posta için aynı 401 ve 429 gövdesi | **Geçti** — `D1c` |
| `X-Forwarded-For` sahteciliği | `TRUST_PROXY` yokken başlık yok sayılır; IP sınırı atlanamaz | **Geçti** — `D1d`, birim testi |
| Oturum iptali | Çıkış, kullanıcı ve acente pasifleştirme; pasif acente girişi reddi; `Bearer` öneki zorunlu | **Geçti** — `D2` |
| Güvenlik başlıkları ve `/ready` | — | **Geçti** — `D3` |
| İlk yönetici CLI | Parola stdin'den, ekrana yazılmaz, tekrar ve kısa parola reddedilir | **Geçti** — `D4` |
| Yedekten geri yükleme | Ayrı veritabanına geri yükleme, birebir aynı; bozulmuş kopya yakalanır | **Geçti** — `infra/scripts/backup-restore-drill.sh`, yerel (2.3) + CI |
| Temel performans | 200 otel / 400 fiyat planı / 24.000 envanter satırı; 10 eşzamanlı arama p95 < 500 ms | **Geçti** — `infra/scripts/perf-smoke.ts`, CI 2.3 (p95 150 ms) |
| Derlenmiş sunucu | `dist-server` ile voucher fontları ve `/ready` | **Geçti** — CI adımı (2.3) |
| Onay anında düşüm (hedef davranış) | — | Uygulanmadı (karar 1 bekliyor) |
| Rebooking/RateRelay v1 paketinde devre dışı | — | Uygulanmadı (tarayıcı uygulamasını değiştirir; karar 10 bekliyor) |
| Arayüzün API'ye bağlanması (uçtan uca tarayıcı testi) | — | Uygulanmadı |
| Üretimde HTTPS, günlük yedek, SMTP | — | Uygulanmadı (hosting kararı) |

## 12. Riskler

1. **Ürün kararlarının gecikmesi:** §13 kararları alınmadan adım 3-6 kesinleşemez.
2. **Fiyat semantiği:** net/brüt, vergi, acente kuralı, kur kaynağı ve yuvarlama tek iş kuralı olarak onaylanmalı.
3. **Eşdeğerlik sözlüğü:** oda, pansiyon, iptal ve ödeme sınıfları için yönetilebilir sabit listeler gerekir.
4. **Veri göçü:** demo seed ve localStorage verisi üretime otomatik taşınmaz; taşınacak veri için eşleme ve sayım/tutar mutabakatı yapılır.
5. **UI geçişi:** mevcut ekranlar tarayıcı içi iş kuralına bağlı; use-case API'lerine geçiş tahmin edilenden uzun sürebilir.
6. **Hosting:** bölge, KVKK, SLA, bütçe ve operasyon sorumlusu belirlenmeden sağlayıcı kesinleşmez.
7. **Yük:** gerçek trafik profili olmadan kapasite taahhüdü verilmez; staging ölçümüyle belirlenir.

## 13. Kararlar

### 13.1 Proje sahibi tarafından onaylanan kararlar (KARAR VERİLDİ)

| Karar | İçerik | Uygulama |
|---|---|---|
| Fiyat modeli | `inventory_daily.price` net gecelik fiyattır; acente markup'ı yüzde veya sabit tutar. Rezervasyonda gecelik fiyatlar snapshot olarak saklanır; sonraki fiyat değişikliği mevcut rezervasyonu etkilemez. Override modeli yoktur. | `002`, `server/pricing.ts`, test `18` |
| Back Office kapsamı | Platform geneli: tüm oteller ve rezervasyonlar; ana acente kiracısına bağlı değil; yetki backend'de. Ana acente ve alt acente izolasyonu korunur. | `002`, `server/app.ts`, testler `09`, `10` |
| İptal yetkileri | Alt acente yalnız kendi oluşturduğu `draft` (taslak) veya `pending` rezervasyonu iptal eder; taslak iptali kontenjan iadesi yapmaz (taslak kontenjan tüketmemiştir). Onaylı rezervasyonu Back Office veya sistem yöneticisi iptal eder. Ana acentenin iptal yetkisi yoktur. Tekrarlanan iptal kontenjanı artırmaz. | `server/app.ts`, testler `07`, `08`, `11`, `11b`, `12`, `B2` |
| Zorunlu misafir alanları | Ad, soyad, yetişkin sayısı, çocuk sayısı, çocuk yaşları, e-posta, telefon, uyruk, operasyon notu; backend doğrulaması. | `server/validation.ts`, test `17` |

### 13.2 Açık kararlar (ÖNERİLEN — ONAY BEKLİYOR)

| # | Karar | Mevcut / uygulanan varsayılan | Öneri |
|---|---|---|---|
| 1 | Kontenjan ne zaman düşer? | Talep anında (`pending`); ret/iptalde tek iade | Yalnız Back Office onayı anında |
| 2 | Backend | PR #2 temeli (Express 5) kullanılıyor | Aynı temelle devam |
| 3 | Eşdeğerlik anahtarı iptal ve ödeme koşulunu içerir mi? | Evet (uygulandı) | Evet |
| 5 | Karşılaştırma para birimi ve kur kaynağı | EUR; `fx_rates` tablosu; kaynak alanı zorunlu, kaynak seçimi yapılmadı | EUR; kur kaynağı belirlenmeli |
| 6 | Eşit fiyatta kazanan | En küçük fiyat planı id (uygulandı) | Aynı veya iş kuralı |
| 9 | PostgreSQL sürümü ve hosting bölgesi | Testler PostgreSQL 16 ile | PostgreSQL 16; TR veya AB, KVKK değerlendirmesi |
| 10 | Rebooking/RateRelay | v1 dışı | Ayrı onay |
| 11 | Pazar / milliyet satış kısıtı (B4B-03) | Veri modelinde yok; eşdeğerlik anahtarında yok; `sales_conditions` içeriği aramada uygulanmaz, yalnız teklifleri ayırır | Fiyat planına yapılandırılmış `markets` alanı + aramada uygunluk filtresi + anahtara ekleme; proje sahibi kararı gerekir |
| 12 | Acente yayın koşulları (`agency_hotel_sales.agency_conditions`) | Kullanılmıyor; anahtarda yok | Kullanım amacı netleşmeli |

(4, 7 ve 8 numaralı kararlar 13.1'de kesinleşti.)

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
