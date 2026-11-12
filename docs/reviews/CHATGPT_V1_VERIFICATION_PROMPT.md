# ChatGPT başlatma metni — BED4BOOK v1 bağımsız doğrulama ve test görevi

Merhaba ChatGPT. Claude, BED4BOOK v1 sunucusunda bir dizi düzeltme ve yeni özellik geliştirdi. Senden bunları **bağımsız olarak test etmeni ve denetlemeni** istiyorum. Claude'un yaptıklarını ve raporladığı sonuçları otomatik olarak doğru kabul etme: her iddiayı ya komut çalıştırarak ya da kodu okuyarak kendin doğrula.

## Kurallar

- **Bu bir doğrulama görevidir.** Kodu değiştirme, commit atma, PR'ı merge etme, main dalına bir şey gönderme. Hata bulursan raporla; düzeltmeyi önerebilirsin ama uygulama.
- Çalıştıramadığın bir komutu "geçti" sayma. Neden çalıştıramadığını yaz.
- Test sonucu, log veya CI bağlantısı uydurma. Her PASS için gerçek çıktıyı ver.
- Yalnızca kod okuyarak vardığın sonuçları **"KOD İNCELEMESİ"** diye ayrıca işaretle; bunlar PASS sayılmaz.
- Testler veritabanındaki tüm tabloları boşaltır (`TRUNCATE`). **Yalnızca boş, geçici bir test veritabanı** kullan.

## Nerede

- Depo: `kosker-07/Book4me`
- Dal: **`claude/clever-thompson-awnwcc`**. Temeli `feature/bed4book-v1-server-foundation` (PR #2).
- İlgili belgeler:
  - Yol haritası v2.2: `docs/TECHNICAL_ARCHITECTURE_DATA_ROADMAP_TR.md` (§11 test matrisi, §13 kararlar)
  - Önceki denetimler: `docs/reviews/CLAUDE_V1_TECHNICAL_REVIEW.md`, `docs/reviews/CLAUDE_ARCHITECTURE_ROADMAP_REVIEW.md`
  - Bağlayıcı şartnameler: `docs/BED4BOOK_Teknik_Sartname.md`, `docs/BED4BOOK_Proje_Sartnamesi.md`

## Proje sahibinin kesin ürün kuralları

Her testte bu kuralları referans al. Bir kuralın zayıfladığını görürsen **Kritik** bulgu olarak raporla.

1. **Kilit yok.** HOLD / HELD / LOCKED / süreli tutma yok. Arama envanteri değiştirmez ve hiçbir kayıt oluşturmaz. Envanter için açık `SELECT … FOR UPDATE` yok. Kapasite kontrolü ve düşüm tek atomik koşullu SQL ile yapılır. Çok gecelikte bir gece başarısız olursa hepsi geri alınır.
2. **En düşük fiyat kazanır.** Aynı eşdeğerlik anahtarındaki teklifler karşılaştırılır ve yalnız en düşük kazanır. Kuru olmayan teklif değerlendirilmez. Eşit fiyatta deterministik tie-break uygulanır. Kazanan başarısız olursa ikinci teklif denenmez. Rakip fiyatı ve bilgisi sızmaz.
3. **Back Office platform genelinde yetkilidir:** tüm oteller ve rezervasyonlar. Bir ana acenteye bağlı değildir. Yetki backend'de uygulanır; acente izolasyonu korunur.
4. **İptal yetkileri:**
   - Alt acente yalnız kendi bekleyen (veya taslak) rezervasyonunu iptal eder.
   - Onaylıyı yalnız Back Office veya sistem yöneticisi iptal eder.
   - Ana acentenin iptal yetkisi yoktur.
   - Tekrarlanan iptal stoğu artırmaz.
5. **Fiyat:** `inventory_daily.price` net gecelik fiyattır; acente markup'ı yüzde veya sabittir; override yoktur. Gecelik fiyat snapshot'ı tutulur ve sonradan yapılan fiyat değişikliği mevcut rezervasyonu etkilemez.
6. **Zorunlu misafir alanları (backend doğrular):** ad, soyad, yetişkin sayısı, çocuk sayısı, çocuk yaşları, e-posta, telefon, uyruk, operasyon notu.
7. **Henüz karar verilmemiş konu:** Kontenjan bugün rezervasyon talebi (`pending`) oluşurken düşüyor; ret veya iptalde bir kez iade ediliyor. Hedef olarak "yalnız onay anında düşüm" önerildi; proje sahibi karar vermedi. Bu davranışı **hata olarak raporlama**. Ancak mevcut davranışın tutarlı olduğunu doğrula.

---

## BÖLÜM 1 — Kurulum ve komutlar

`package.json`'daki gerçek script'ler: `build:server`, `start:server`, `dev:server`, `test:server`, `admin:create`, `perf:smoke`. **`npm run build` ve `npm test` bu projede yoktur.** Bunları çalıştırıp "Missing script" sonucunu raporla; uydurma.

```bash
git clone https://github.com/kosker-07/Book4me.git && cd Book4me
git checkout claude/clever-thompson-awnwcc
node -v                                  # 22.x
docker run -d --name b4b-pg -e POSTGRES_PASSWORD=test -p 5432:5432 postgres:16
sleep 5
export BASE=postgres://postgres:test@localhost:5432
psql $BASE/postgres -c "CREATE DATABASE bed4book_test"
for f in server/migrations/*.sql; do psql $BASE/bed4book_test -v ON_ERROR_STOP=1 -q -f "$f"; done
sudo apt-get install -y poppler-utils    # pdftotext: voucher içeriğini doğrulamak için
npm ci
npm run build                            # beklenen: Missing script (raporla)
npm test                                 # beklenen: Missing script (raporla)
npm run build:server
DATABASE_URL=$BASE/bed4book_test npm run test:server
```

**Beklenen:** `# tests 51`, `# pass 51`, `# fail 0`, `# skipped 0`.
- Testler üç dosyada: `booking.integration.test.ts` (27), `v1-flows.integration.test.ts` (12), `rules.test.ts` (10 birim).
- Bunlara ek olarak `security.test.ts` var (2 birim).
- `pdftotext` yoksa voucher içerik kontrolü atlanır; bu durumda A2'nin içerik kısmını PASS sayma.

### 1.1 Migration güvenliği

```bash
# a) Tekrar çalıştırılabilirlik
for f in server/migrations/00[2-9]*.sql; do psql $BASE/bed4book_test -v ON_ERROR_STOP=1 -q -f "$f"; done

# b) Yalnız 001 ve eski veri içeren bir veritabanını yükseltme
psql $BASE/postgres -c "CREATE DATABASE bed4book_upgrade"
psql $BASE/bed4book_upgrade -v ON_ERROR_STOP=1 -q -f server/migrations/001_initial.sql
psql $BASE/bed4book_upgrade -v ON_ERROR_STOP=1 -q -f tests/server/migrations/legacy_001_data.sql
for f in server/migrations/00[2-9]*.sql; do psql $BASE/bed4book_upgrade -v ON_ERROR_STOP=1 -q -f "$f"; done
psql $BASE/bed4book_upgrade -v ON_ERROR_STOP=1 -f tests/server/migrations/legacy_upgrade_checks.sql   # "legacy upgrade checks passed"

# c) 001_initial.sql değişmedi mi?
git diff origin/feature/bed4book-v1-server-foundation -- server/migrations/001_initial.sql   # boş olmalı
```

### 1.2 Yedek → geri yükleme tatbikatı

```bash
psql $BASE/bed4book_upgrade -v ON_ERROR_STOP=1 -q -f tests/server/migrations/drill_v1_data.sql
SOURCE_URL=$BASE/bed4book_upgrade ADMIN_URL=$BASE/postgres RESTORE_DB=bed4book_restore_drill infra/scripts/backup-restore-drill.sh
# beklenen: RESTORE DRILL PASSED, exit 0

DRILL_TAMPER_SQL="UPDATE bookings SET total = total + 1" SOURCE_URL=$BASE/bed4book_upgrade ADMIN_URL=$BASE/postgres RESTORE_DB=bed4book_restore_drill infra/scripts/backup-restore-drill.sh
# beklenen: RESTORE DRILL FAILED, exit 1 (karşılaştırmanın farkı yakaladığının kanıtı)
```

### 1.3 Performans ve derlenmiş sunucu

```bash
psql $BASE/postgres -c "CREATE DATABASE bed4book_perf"
for f in server/migrations/*.sql; do psql $BASE/bed4book_perf -v ON_ERROR_STOP=1 -q -f "$f"; done
DATABASE_URL=$BASE/bed4book_perf npm run perf:smoke        # search p95 < 500 ms beklenir; gerçek değerleri yaz

DATABASE_URL=$BASE/bed4book_test SESSION_SECRET=$(openssl rand -hex 32) PORT=3999 npm run start:server &
curl -s localhost:3999/ready   # {"ok":true,"database":"up"}
kill %1
```

### 1.4 İlk yönetici CLI

```bash
echo -n 'a-very-long-root-password' | DATABASE_URL=$BASE/bed4book_test npm run admin:create -- root@example.com
# beklenen: oluşturuldu; parola ekranda yok. Aynı komut ikinci kez → hata. 12 karakterden kısa parola → hata.
```

### 1.5 Tarayıcı uygulaması ve eski testler

`src/` bu dalda değişmedi: `git diff origin/main -- src tools` boş olmalı. Yine de çalıştır:

```bash
node tools/build.js
node tests/unit.js           # Claude: 26 geçti, 4 kaldı (4'ü depo dışı /home/user/paket/... fikstürü)
node tests/u008-bed4book.js  # Claude: geçti
node tests/bed4book.js       # Claude: geçti
for t in ui-flow u002-ui u002-yama1 u003-dashboard u004-sade u005-mudahale u005-ciftekran u006-crystal u007-pazar u007c-tema u001-logo; do node tests/$t.js | tail -1; done
git checkout -- dist/index.html   # derleme çıktısını commit etme
```

Claude'un raporu:
- `ui-flow` 23/23, `u002-ui` 24/24, `u002-yama1` 20/20, `u003-dashboard` 33/33, `u005-mudahale` 59/59, `u005-ciftekran` 19/19, `u006-crystal` 26/26, `u007-pazar` 39/39, `u007c-tema` 10/10 geçti.
- `u004-sade` kararsız: değiştirilmemiş `main` dalında da 4 çalıştırmanın 2'sinde 30 sn zaman aşımı.
- `u001-logo` depo dışı `/tmp/logo1.png` dosyasını istediği için çalışmıyor.

Bunları kendin doğrula. `u004-sade`'yi `main` dalında ve bu dalda **en az üçer kez** çalıştırarak karşılaştır.

### 1.6 CI

`claude/clever-thompson-awnwcc` dalının son commit'i için GitHub Actions'taki **"BED4BOOK v1 server checks"** iş akışını aç. Şu adımların hepsinin geçtiğini kontrol et:
- PostgreSQL 16 servisi
- `npm ci`
- poppler-utils kurulumu
- Migration'ları uygulama ve tekrar uygulama
- Eski veriyle yükseltme
- Yedek tatbikatı ve öz-testi
- `build:server`
- Derlenmiş sunucu smoke testi
- `test:server` (51/51)
- Performans

Bağlantıyı ve log'daki `# tests / # pass / # fail` satırlarını rapora koy.

---

## BÖLÜM 2 — Testlerin gerçekten hatayı yakaladığını kanıtla (mutation testi)

Yeşil testler tek başına yeterli değildir. Aşağıdaki her maddede kodu **geçici olarak** boz, `npm run test:server` çalıştır, **en az bir testin kırmızıya döndüğünü** göster, sonra `git checkout -- <dosya>` ile geri al. Hiçbir test kırmızıya dönmüyorsa bu bir **test eksikliği bulgusudur**.

| # | Geçici bozma | Dosya | Beklenen kırmızı test(ler) |
|---|---|---|---|
| M1 | Ret/iptalde `releaseInventory` çağrısını kaldır | `server/app.ts` (`transition`) | `11`, `12` |
| M2 | `chooseWinners` içinde `<` yerine `>` (en yüksek fiyat kazansın) | `server/pricing.ts` | `13` ve birim testleri |
| M3 | Kur yoksa `?? 1` ile kur 1 say | `server/pricing.ts` (`priceCandidate`) | `15b` |
| M4 | Ana acentenin iptal engelini kaldır | `server/app.ts` (`PATCH …/status`) | `08` |
| M5 | `isPlatformWide`'dan `back_office`'i çıkar | `server/http.ts` | `09`, `11`, `12` |
| M6 | Arama uç noktasına envanteri değiştiren bir `UPDATE` ekle | `server/app.ts` (`/api/agency/searches`) | `01` |
| M7 | Envanter `UPDATE`'i başarısız olunca başka bir fiyat planına geçsin **ve** fiyat kontrolünü kaldır | `server/app.ts` (`reserveNights`) | `14` |
| M8 | Herhangi bir sorguya `FOR UPDATE` ekle | `server/*.ts` | statik tarama testi (`rules.test.ts`) |
| M9 | Alt acentenin onaylı rezervasyonu iptal etmesine izin ver | `server/app.ts` (`from: ["draft","pending"]`) | `11b` |
| M10 | Telefon doğrulamasını kaldır | `server/validation.ts` | `17` |
| M11 | Taslakta da kontenjan düşsün | `server/app.ts` (`if (!asDraft)`) | `B1`, `B2` |
| M12 | Taslak iptalinde de iade yapılsın | `server/app.ts` (`CONSUMES_INVENTORY`) | `B2` |
| M13 | Onaysız rezervasyona voucher verilsin | `server/app.ts` (`sendVoucher`) | `A2`, `A3` |
| M14 | Ana acente başka otelleri de yönetebilsin | `server/admin-routes.ts` (`ownedHotel`) | `C1` |
| M15 | Giriş kilidini kaldır | `server/app.ts` (login) | `D1` |
| M16 | `token_version` karşılaştırmasını kaldır | `server/http.ts` | `D2` |
| M17 | Yayın hedefinin alt acente olma şartını kaldır | `server/admin-routes.ts` | `C2` |
| M18 | Voucher'da otel adı yerine konum yaz | `server/voucher.ts` | `A2` |

Claude bu 18 bozmanın hepsinde en az bir testin kırmızıya döndüğünü raporladı. **Kendin tekrarla**; sonucu tablo olarak ver.

---

## BÖLÜM 3 — Kod incelemesi (her cevabı dosya:satır ile ver)

1. Sunucu kodunda envanter için açık kilit var mı? Kontenjan düşümünü yapan SQL'i alıntıla. Neden kilitsiz ama yine de aşım yapmıyor?
2. Arama (`POST /api/agency/searches`) veritabanına herhangi bir şey yazıyor mu? `quoteId` nasıl üretiliyor? Sahte veya süresi dolmuş quote ile rezervasyon mümkün mü?
3. Rezervasyon sırasında hangi fiyat planı yeniden kontrol ediliyor? Kontrol başarısız olunca kod başka bir teklife geçebilir mi?
4. Eşdeğerlik anahtarı hangi alanlardan oluşuyor (`server/pricing.ts`)? Eksik bir alan var mı (ör. pazar/milliyet)? Bu bir risk mi?
5. Aynı rezervasyon iki kez, hatta aynı anda iptal edilirse stok iki kez iade edilebilir mi? Hangi SQL bunu engelliyor?
6. Back Office ve sistem yöneticisi bir acenteye bağlı mı? (`002` migration, `server/http.ts` `isPlatformWide`, `server/admin-routes.ts` `ownedHotel`.) Ana acente başka bir ana acentenin otelini yönetebilir mi?
7. Ana acente rezervasyon iptal edebilir mi? Onay/ret yapabilir mi, yalnız kendi otellerinde mi?
8. Fiyat snapshot'ı nerede tutuluyor? Rezervasyon detayında gösterilen tutar snapshot'tan mı yoksa güncel fiyattan mı geliyor?
9. Dokuz zorunlu misafir alanının hepsi backend'de doğrulanıyor mu? Uyruk ve telefon formatı yeterli mi?
10. Idempotency: aynı anahtarla aynı anda gelen istekler nasıl tek rezervasyona indiriliyor? Farklı içerikle aynı anahtar ne döndürüyor?
11. `002` migration'ı mevcut `back_office` kullanıcılarına ne yapıyor? Geriye uyumlu mu? `001_initial.sql` değişmiş mi?
12. Voucher: şartnamedeki alanların hepsi var mı (rezervasyon no, otel, tarihler, oda/pansiyon, misafir, operasyon notları)? Kişisel ad, telefon veya unvan var mı? Logo neden yok? (İpucu: logo kaynak dosyası depoda yok; renkler tahmin edilmemeli.)
13. Giriş kilidi: e-posta başına 5, IP başına 20 başarısız deneme / 15 dk. Bu tasarımın bir zayıflığı var mı (ör. hesap kilitletme saldırısı)?
14. `POST /api/agency/bookings` artık `ratePlanId` yerine `quoteId` istiyor. Bu sözleşme değişikliği belgelenmiş mi (yol haritası §7)?

---

## BÖLÜM 4 — Belge doğrulaması

`docs/TECHNICAL_ARCHITECTURE_DATA_ROADMAP_TR.md` (v2.2):

- §13.1'deki kararlar (fiyat modeli, Back Office kapsamı, iptal yetkileri, misafir alanları) kodla uyumlu mu?
- Back Office'i ana acenteye bağlayan bir ifade kaldı mı?
- §11 test matrisinde "Geçti" yazan her satır gerçekten var olan ve senin çalıştırdığın bir teste karşılık geliyor mu? Var olmayan bir test "Geçti" görünüyor mu?
- "Uygulanmadı" satırları doğru mu?

---

## Bilinen ve bilerek bırakılan açıklar

Bunları "eksik" olarak listeleyebilirsin; ama "Claude yaptı ama bozuk" diye sayma:

- Kontenjanın onay anında düşmesi (karar bekliyor).
- Tarayıcı arayüzü henüz API'ye bağlı değil; uçtan uca tarayıcı testi yok.
- `/api/v1` sürüm öneki, RLS, audit kayıtlarında önceki/sonraki değer ve IP, migration çalıştırıcı (`schema_migrations`).
- CORS, HTTPS ve ters proxy, üretimde günlük yedek ve SMTP (hosting kararı).
- Görsel yükleme, nesne depolama, resmi logo dosyası.
- Rebooking/RateRelay modüllerinin tarayıcı paketinde devre dışı bırakılması (tarayıcı uygulamasını değiştirir; karar bekliyor).
- Depodaki `dist/index.html` kaynakla güncel değil (önceden var olan durum).

---

## Teslim formatı

```
GENEL SONUÇ: ONAY / DÜZELTME GEREKLİ / RED

| Alan | Sonuç (PASS/FAIL/DOĞRULANAMADI) | Kanıt (komut + gerçek çıktı veya CI bağlantısı) |
|---|---|---|
| Rezervasyon kilidi yok | | |
| Arama envanteri değiştirmiyor | | |
| Atomik stok kontrolü ve geri alma | | |
| En düşük fiyat / eşdeğerlik / kur | | |
| İkinci teklife geçilmiyor | | |
| Rakip bilgisi sızmıyor | | |
| Back Office platform erişimi | | |
| İptal yetkileri ve tek iade | | |
| Fiyat snapshot'ı | | |
| Misafir validasyonu | | |
| Taslak akışı | | |
| Yönetim API'leri ve yetkileri | | |
| Voucher (içerik + yetki) | | |
| Giriş kilidi ve oturum iptali | | |
| Migration güvenliği (boş / tekrar / yükseltme / 001 değişmedi) | | |
| Yedek → geri yükleme tatbikatı | | |
| Performans (p95 değerleri) | | |
| Derlenmiş sunucu | | |
| Tarayıcı uyumluluğu (u004-sade main ile karşılaştırma dahil) | | |
| CI | | |

MUTATION TESTİ: M1–M18 için kırmızıya dönen test(ler)
KOD İNCELEMESİ: 1–14 cevapları (dosya:satır)
BELGE: Bölüm 4 kontrolleri
YENİ BULGULAR: ID | Kritik/Yüksek/Orta/Düşük | dosya:satır | sorun | önerilen düzeltme | yeniden üretme adımı
CLAUDE İLE AYRIŞTIĞIM NOKTALAR: madde — gerekçe
```
