# BED4BOOK v1 — Bağımsız Denetim Bulguları (B4B-01…05): Teslim Raporu

- Dal: `claude/clever-thompson-awnwcc` (temel: `feature/bed4book-v1-server-foundation`)
- Tarih: 07.11.2026
- Doğrulama ortamları:
  - **Yerel:** Node 22.23, PostgreSQL 16.15. Geçici küme yalnız Unix soketiyle dinledi, TCP kapalıydı. npm kayıt defterine erişim yoktu, `npm ci` çalışmadı.
  - **CI:** GitHub Actions, Node 22, PostgreSQL 16 servis konteyneri. Çalıştırma [42412151072](https://github.com/kosker-07/Book4me/actions/runs/42412151072), commit `eb18003`. `server` ve `mutation` işleri başarılı.
- Kapsam dışı (görev gereği yapılmadı): main'e commit veya merge, PR merge, Railway deploy, `src/` ve `tools/` değişikliği.

## A. Yapılan değişiklikler

| Dosya | Değişiklik | Neden |
|---|---|---|
| `server/login-guard.ts` (yeni) | Giriş sınırı politikası: başarısız denemeler 15 dakikalık pencerede sayılır. Sınırlar: hesap + IP için 5, IP için 20, hesap için 100. Ayrıca `TRUST_PROXY` ayrıştırıcısı. İkisi de saf fonksiyon. | B4B-01, B4B-02 |
| `server/app.ts` | `trust proxy` açıkça yapılandırılıyor. Giriş sorgusu üç sayacı birlikte hesaplıyor; pencere parametreli (`make_interval`). | B4B-01, B4B-02 |
| `server/app.ts` | `request_hash` alanı NULL olan eski idempotency anahtarı için: kayıtlı rezervasyon yeni istekle aynıysa yanıt tekrar oynatılır ve parmak izi bağlanır. Aynı değilse 422 `IDEMPOTENCY_KEY_REUSED` döner. Yanıtında rezervasyon id'si olmayan eski anahtar da 422 alır. | B4B-04 |
| `server/app.ts`, `server/pricing.ts` | `rate_plans.sales_conditions` aday sorgusuna ve eşdeğerlik anahtarına eklendi. Anahtar sırası grubu bölmez; boş ve eksik değer eşdeğer sayılır. | B4B-03 |
| `.env.example` | `NODE_ENV` ve `TRUST_PROXY` örnekleri eklendi. | B4B-02 |
| `tests/server/security.test.ts` | 4 yeni birim testi: giriş politikası, hesap kilitleme saldırısı senaryosu, `TRUST_PROXY` ayrıştırma. | B4B-01, B4B-02 |
| `tests/server/rules.test.ts` | 1 yeni birim testi: farklı satış koşulları ayrı grup oluşturur, anahtar sırası grubu bölmez. | B4B-03 |
| `tests/server/booking.integration.test.ts` | Yeni testler: `05c` (eski anahtar, eşzamanlı tekrarlar), `05d` (yanıtsız eski anahtar), `15c` (satış koşulları, sızıntı yok). | B4B-03, B4B-04 |
| `tests/server/v1-flows.integration.test.ts` | Yeni testler: `D1b` (hesap kilitleme saldırısı ve dağıtık saldırı sınırı), `D1c` (hesap varlığı sızmaz), `D1d` (`X-Forwarded-For` sahteciliği). `D1`'in adı yeni davranışa göre düzeltildi; beklentileri aynı kaldı. | B4B-01, B4B-02 |
| `tests/server/migrations/legacy_001_data.sql`, `legacy_upgrade_checks.sql` | 002 öncesi biçimde bir idempotency anahtarı eklendi. Yükseltmeden sonra bu anahtarın korunduğu doğrulanıyor. | B4B-04 |
| `infra/scripts/mutation-check.mjs` (yeni) | M1–M18 otomatik mutation kontrolü. Her mutation'dan sonra dosya geri yazılıyor ve `git diff --quiet` ile doğrulanıyor; Ctrl-C ve çökme durumunda da geri alınıyor. Testler yalnız yerel ve yeni oluşturulan bir veritabanında çalışıyor, sonunda bu veritabanı siliniyor. Ek modlar: `--dry-run`, `--unit-only`. | Görev §4 |
| `.github/workflows/bed4book-v1-server.yml` | `mutation` işi eklendi (`server` işinden sonra çalışır). | Görev §4–5 |
| `docs/TECHNICAL_ARCHITECTURE_DATA_ROADMAP_TR.md` | Sürüm 2.3. §11'de dört test dosyası listelendi. §13.1'de alt acentenin `draft` iptal hakkı yazıldı. §6.3 ve §7'deki eski "henüz uygulanmadı" ifadeleri düzeltildi. §3.3 ve §11 gerçek sonuçlarla güncellendi. §13.2'ye karar 11 (pazar/milliyet) ve karar 12 (`agency_conditions`) eklendi. | B4B-05 |

## B. Test sonuçları

| Test | Sonuç | Gerçek çıktı |
|---|---|---|
| Build | **PASS** (CI) | `npm run build:server` başarılı. Derlenmiş voucher 23.382 bayt, PDF imzası doğru. Yerel ortamda DOĞRULANAMADI (npm yok). |
| Server tests | **PASS** (CI) | `# tests 62 # pass 62 # fail 0 # skipped 0`. Yerelde yalnız 17 birim testi çalıştı: 17/17. |
| Derlenmiş sunucu `/ready` | **PASS** (CI) | `{"ok":true,"database":"up"}` |
| Migration | **PASS** (yerel + CI) | Boş veritabanına 001→003 uygulandı. 002 ve 003 tekrar uygulandığında hata yok. 001 ve eski veri üzerine yükseltmede `legacy upgrade checks passed`. |
| Backup/restore | **PASS** (yerel + CI) | `RESTORE DRILL PASSED`. Öz-test: kasıtlı bozulan kopya `RESTORE DRILL FAILED` verdi, yani fark yakalandı. |
| Performance | **PASS** (CI) | Arama (10 eşzamanlı): p50 128,5 ms, p95 150,2 ms. Rezervasyon: p95 36,4 ms. Sınır: 500 ms. |
| Admin CLI | **PASS** (CI) | `D4`: ilk yönetici oluşturuldu, parola ekrana yazılmadı, tekrar oluşturma ve kısa parola reddedildi. |
| Browser tests | **Kısmen** (yerel, sistem Chrome, yeniden derlenmiş paket) | Geçenler: `ui-flow` 23/23, `u002-ui` 24/24, `u002-yama1` 20/20, `u003-dashboard` 33/33, `u005-mudahale` 59/59, `u005-ciftekran` 19/19, `u006-crystal` 26/26, `u007-pazar` 39/39, `u007c-tema` 10/10, `u008-bed4book`, `bed4book`. `u004-sade` **kararsız** (aşağıda). `u001-logo` **çalışmıyor**: depoda olmayan `/tmp/logo1.png` dosyasını istiyor. |
| CI | **PASS** | Çalıştırma [42412151072](https://github.com/kosker-07/Book4me/actions/runs/42412151072): `server` başarılı, `mutation` başarılı. |

`u004-sade`, her çalıştırmanın süresi ve sonucu:

| Dal | #1 | #2 | #3 | Zaman aşımı oranı |
|---|---|---|---|---|
| `main` (`81e3f8a`) | 32,0 sn — zaman aşımı | 32,1 sn — zaman aşımı | 32,1 sn — zaman aşımı | 3/3 |
| Çalışma dalı | 3,7 sn — 61/61 | 32,0 sn — zaman aşımı | 32,1 sn — zaman aşımı | 2/3 |

Bütün zaman aşımları aynı adımda oluyor: "arama sonucundan tek tıkla rezervasyon ekranı" (`tests/u004-sade.js:41`). `src/`, `tools/` ve `dist/` dosyaları `main` ile birebir aynı. Bu yüzden sorun çalışma dalında değil; testle arayüz arasındaki zamanlamada.

Ek kanıt: geçici bir kopyada sonuç butonu beklenerek 6 çalıştırma yapıldı ve 3'ü geçti. Sayfa durumunu okuyan bir tanı satırı eklenince 4/4 geçti. Yani küçük bir gecikme bile sonucu değiştiriyor. Ayrıntılar §F'de.

## C. Mutation testleri

CI `mutation` işinden alındı. Başlangıçta paket 62/62 yeşildi. Her mutation'dan sonra mutate edilen 5 dosya için `git diff --quiet HEAD` temiz çıktı. Son çalıştırma yine 62/62 geçti.

| Mutation | Beklenen kırmızı test | Gerçek kırmızı test | Sonuç |
|---|---|---|---|
| M1 İptal/ret stok iadesini kaldır | 11, 12 | 11, 12 | YAKALANDI |
| M2 En yüksek fiyatı kazandır | 13 | 13 ve 02–05, 05c, 07, 08, 11, 11b, 14, 14b, 15, 15c, 16, 18, birim "winner" testleri | YAKALANDI |
| M3 Kur yoksa 1 kabul et | 15b | 15b ve diğerleri (kurusuz USD teklifi H1/AI sonuç sayısını değiştiriyor), birim "winner" testi | YAKALANDI |
| M4 Ana acente iptal engelini kaldır | 08 | 08 | YAKALANDI |
| M5 Back Office'i platform rolünden çıkar | 09, 11, 12 | 09, 11, 11b, 12, A2, A3, C1 | YAKALANDI |
| M6 Aramaya envanter UPDATE'i ekle | 01 | 01 ve stok sayan diğer testler (02–05, 05c, 05d, 07, 08, 11, 11b, 12, 13b, 14, 14b, 17, B1, B2) | YAKALANDI |
| M7 Stok güncellemesi başarısızsa başka fiyat planına geç | 14 | 14, 02, 03, 04, 14b, B2 | YAKALANDI |
| M8 Sorguya FOR UPDATE ekle | Statik tarama | "no explicit row locks…" | YAKALANDI |
| M9 Alt acenteye onaylı rezervasyon iptali aç | 11b | 11b | YAKALANDI |
| M10 Telefon doğrulamasını kaldır | 17 | 17, birim "validation: guest fields" | YAKALANDI |
| M11 Draft sırasında stok düş | B1, B2 | B1, B2 | YAKALANDI |
| M12 Draft iptalinde stok iadesi yap | B2 | B2 | YAKALANDI |
| M13 Onaysız rezervasyona voucher üret | A2, A3 | A2, A3 | YAKALANDI |
| M14 Ana acenteye başka otel yönetimi aç | C1 | C1 | YAKALANDI |
| M15 Giriş kilidini kaldır | D1 | D1, D1b, D1c, D1d | YAKALANDI |
| M16 token_version kontrolünü kaldır | D2 | D2 | YAKALANDI |
| M17 Yayın hedefi alt acente şartını kaldır | C2 | C2 | YAKALANDI |
| M18 Voucher otel adını konumla değiştir | A2 | A2 | YAKALANDI |

M7 nasıl kuruldu: yalnız stok yedeğine geçmek, fiyat kontrolü (`PRICE_CHANGED`, 409) yüzünden test 14'ü kırmızıya çevirmiyordu. Bu yüzden M7 gerçekçi bir "başka teklife geç" hatası olarak iki değişiklikle kuruldu: başka fiyat planının stoğundan düşmek ve fiyat kontrolünü atlamak. Test 14 bu durumda kırmızıya döndü. Test zayıflatılmadı.

Yerel doğrulama: `--dry-run` ile 18 yamanın her biri kodla tam bir kez eşleşti ve geri alındı. `--unit-only` ile M2, M3, M8 ve M10 birim testlerini kırmızıya çevirdi.

## D. Güvenlik

- **Hesap kilitleme saldırısı.** Sayaçlar hesap + IP (5), IP (20) ve hesap (100) bazında tutuluyor.
  - Saldırganın başka bir IP'den kurbanın e-postasıyla yaptığı denemeler kurbanı kilitlemiyor (`D1b`).
  - Hesap tek başına ancak ≥ 20 IP'den gelen 100 hatada kısıtlanıyor (`D1b`, kalan risk §F).
  - Pencere dışındaki hatalar sayılmıyor (`D1b`).
  - Var olan ve olmayan e-posta için 401 ve 429 gövdeleri aynı (`D1c`).
  - Kilit 429 doğru parolayla da geçerli (`D1`).
- **Proxy IP doğruluğu.** `TRUST_PROXY` varsayılan olarak `false`; bu durumda `X-Forwarded-For` yok sayılıyor. 20 sahte başlıkla yapılan deneme 21.'de 429 alıyor ve sahte IP kayda geçmiyor (`D1d`). `NODE_ENV=production` iken değer zorunlu, `true` reddediliyor, hop sayısı 1–5 arasında olmalı ve adres/CIDR listesi doğrulanıyor (birim testleri).
- **Idempotency yarış koşulları.** Aynı anahtarla 10 paralel istek tek rezervasyon oluşturuyor (`05`). Farklı içerik 422 alıyor (`05b`). Eski anahtarla 5 eşzamanlı tekrar tek rezervasyona iniyor ve stok bir kez düşüyor (`05c`). Yanıtsız eski anahtar yeniden çalıştırılmıyor (`05d`).
- **Yetki kontrolleri.** Hepsi backend'de; M4, M5, M9, M14, M16 ve M17 mutation'larıyla kanıtlandı. Back Office ve system_admin platform genelinde yetkili. Ana acente başka ana acentenin otelini yönetemiyor ve iptal yetkisi yok. Alt acente yalnız kendi `draft` veya `pending` rezervasyonunu iptal edebiliyor. Onaylı rezervasyonu yalnız Back Office veya system_admin iptal edebiliyor.
- **Stok aşımı.** Stok tek atomik koşullu UPDATE ile düşüyor ve açık kilit kullanılmıyor (statik tarama, M8). 20 paralel istekte 5 kontenjan için tam 5 rezervasyon oluşuyor (`03`). Çok gecelik başarısızlıkta işlem tamamen geri alınıyor (`04`). İade yalnız bir kez yapılıyor (`12`, M1).
- **Fiyat manipülasyonu.** Quote imzalı ve süreli; değiştirilmiş quote 400 alıyor (birim testi). Fiyat değiştiyse 409 `PRICE_CHANGED` dönüyor (`14b`). Gecelik fiyat snapshot'ı korunuyor (`18`). Kazanan başarısız olursa ikinci teklif denenmiyor (`14`, M7).
- **Rakip bilgi sızıntısı.** Yanıtta kaybeden teklifin fiyatı, fiyat planı veya acente id'si, net fiyat ve markup yok (`16`). `sales_conditions` arama yanıtında yer almıyor (`15c`).

## E. Migration ve geriye uyumluluk

- **Yeni migration yok.** Taslak 004'te bir indeks vardı. PostgreSQL 16'da `EXPLAIN` ile bakıldığında yeni giriş sorgusu mevcut `login_attempts_email_idx` ve `login_attempts_ip_idx` indekslerini BitmapOr ile kullanıyordu. Gereksiz şema değişikliği yapmamak için 004 kaldırıldı.
- **Eski migration dosyaları değişmedi.** 001, 002 ve 003 aynı.
- **Eski rezervasyonlar korunuyor.** Yükseltme testinde `B4B-LEGACY` rezervasyonu, stok toplamı, kullanıcılar ve 002 öncesi idempotency anahtarı (`request_hash` NULL, yanıt aynı) değişmeden kalıyor (`legacy_upgrade_checks.sql`, yerel ve CI).
- **Eski idempotency anahtarları silinmedi ve geriye doldurulmadı.** Özgün istek gövdesi hiç saklanmadığı için hash yeniden üretilemez. Böyle bir anahtar yalnız kayıtlı rezervasyonla eşleşen ilk istekte bağlanıyor.
- **Davranış değişiklikleri:**
  1. Bir e-posta için başka IP'lerden gelen 5 hata artık o e-postayı herkese kilitlemiyor.
  2. Satış koşulları farklı fiyat planları artık ayrı sonuç olarak dönüyor. Daha önce ucuz olan diğerini gizliyordu.
  3. `NODE_ENV=production` iken `TRUST_PROXY` tanımlı değilse sunucu açılmıyor. Bu kasıtlı.

## F. Kalan sorunlar

| # | Önem | Dosya / satır | Yeniden üretme | Önerilen çözüm |
|---|---|---|---|---|
| 1 | **Yüksek (deploy öncesi)** | `server/app.ts:17`, `.env.example` | `NODE_ENV=production` ile `TRUST_PROXY` tanımlanmadan başlatınca sunucu açılmıyor. `TRUST_PROXY=false` ile reverse proxy arkasında çalışırsa bütün istemciler proxy IP'sini paylaşır; 20 hata herkesi 429'a düşürür. | Railway'de `NODE_ENV=production` ve `TRUST_PROXY=1` ayarlanmalı, sonra staging'de `req.ip` loglanarak gerçek istemci IP'si doğrulanmalı. `1` değeri, proxy'nin `X-Forwarded-For` başlığının **sonuna** gerçek IP'yi eklediği varsayımına dayanıyor; bu Railway için bu çalışmada doğrulanmadı. |
| 2 | Orta | `server/login-guard.ts` (`perAccount: 100`) | 20 farklı IP'den 5'er hata, hesabı 15 dakika herkese kapatır (`D1b`). | Kalan risk bilerek kabul edildi. Kalıcı çözüm için CAPTCHA, kademeli gecikme veya Back Office/sistem yöneticisine MFA (§9) düşünülebilir. |
| 3 | Orta (ürün kararı) | `server/pricing.ts` `equivalenceKey`; `server/app.ts` `loadCandidates` | `sales_conditions = {"markets":["UK"]}` olan teklif aramada her milliyete gösteriliyor; koşul yalnız teklifleri ayırıyor, filtre olarak uygulanmıyor. | Pazar/milliyet için yapılandırılmış alan, aramada uygunluk filtresi ve anahtara ekleme gerekir. Karar 11, proje sahibinin kararı bekleniyor. Varsayımla eklenmedi. |
| 4 | Düşük | `agency_hotel_sales.agency_conditions` | Kodda okunmuyor. | Karar 12: amacı netleşmeli. |
| 5 | Düşük | `tests/u004-sade.js:41`; `src/updates/u004c-search-ui.js` | `main` ve dalda 6 çalıştırmanın 5'inde 30 sn zaman aşımı. Bazı çalıştırmalarda sonuç listesi hiç oluşmuyor; küçük bir gecikme sonucu değiştiriyor. | Test, arama kutusunu doldurduktan sonra sonuç listesinde aranan kaydı bekleyip gerekirse doldurmayı yeniden denemeli. Arayüz tarafında yeniden çizimde arama kutusunun değeri ve sonuçları korunmalı. Görev kapsamı gereği `src/` ve test değiştirilmedi. |
| 6 | Düşük | `tests/u001-logo.js` | `ENOENT: /tmp/logo1.png` | Logo fikstürü `tests/fixtures/` altına eklenmeli ve test bu yolu kullanmalı. |
| 7 | Düşük | `login_attempts` | Tablo süresiz büyüyor. | Saklama süresi belirlenmeli (ör. 90 gün) ve gece temizlik işi eklenmeli. |
| 8 | Düşük | `server/app.ts` eski idempotency dalı | Eski anahtarla gelen ve yalnız telefon/e-postası farklı bir istek eşleşme sayılıp parmak izini bağlar. | Kabul edilebilir: ikinci rezervasyon oluşmuyor. Gerekirse eşleşme alanları genişletilebilir. |
| 9 | Düşük (önceden var) | `dist/index.html` | `node tools/build.js` çıktısı depodakiyle aynı değil. | Derleme çıktısı yeniden üretilip commit edilmeli, ya da CI'da derlenip kontrol edilmeli. |
| 10 | Düşük (önceden var) | `tests/unit.js` | 25 geçti, 5 kaldı. Kalan 5'i depo dışı `../paket/...` fikstür yolunu arıyor. | Fikstürler depoya alınmalı. |

## G. Git bilgisi

- Çalışılan dal: `claude/clever-thompson-awnwcc`
- Başlangıç commit'i: `1d3ec84`
- Commit'ler:
  - `e253013` fix(server): B4B-01..04
  - `652f588` test(infra): mutation check
  - `eb18003` docs+ci: roadmap v2.3, CI mutation job
  - Bu rapor ve §3.3/§11 CI güncellemesi son commit'tedir (`git log -1`).
- Değiştirilen dosyalar: §A'daki tablo.
- Yeni migration dosyası: yok.
- PR: Bu dalın kendi PR'ı yok. İlgili PR [#2](https://github.com/kosker-07/Book4me/pull/2) `feature/bed4book-v1-server-foundation → main` olarak açık. Merge yapılmadı.
