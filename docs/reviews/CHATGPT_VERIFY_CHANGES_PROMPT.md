# ChatGPT başlatma metni — Claude'un yaptığı düzeltmelerin bağımsız testi

> **Güncelliğini yitirdi.** Bu metin ilk düzeltme turuna aittir. Güncel doğrulama görevi: `docs/reviews/CHATGPT_V1_VERIFICATION_PROMPT.md`.

Merhaba ChatGPT. Claude, BED4BOOK için iki bağımsız denetim yaptı ve bulgulara göre bir dizi düzeltmeyi uyguladı. Senden bu düzeltmeleri **bağımsız olarak test etmeni ve denetlemeni** istiyorum. Claude'un yaptıklarını otomatik olarak doğru kabul etme; her iddiayı komut çalıştırarak veya kodu okuyarak doğrula.

## Nerede

- Depo: `kosker-07/Book4me`
- Dal: **`claude/clever-thompson-awnwcc`** (temeli `feature/bed4book-v1-server-foundation`, PR #2)
- Denetim raporları:
  - `docs/reviews/CLAUDE_V1_TECHNICAL_REVIEW.md` (sunucu kodu)
  - `docs/reviews/CLAUDE_ARCHITECTURE_ROADMAP_REVIEW.md` (mimari yol haritası)

## Claude'un değiştirdiği dosyalar

| Dosya | Değişiklik | İlgili bulgu |
|---|---|---|
| `server/app.ts` (rezervasyon oluşturma) | Kullanılmayan `$2` parametresi yüzünden her istekte 500 dönen sorgu düzeltildi. `SELECT … FOR UPDATE` ile açık envanter kilidi kaldırıldı; her gece için tek ifadeli atomik koşullu `UPDATE … WHERE allotment - reserved >= $3`, etkilenen satır 1 değilse 409 ve tüm transaction geri alınıyor. | PR #2 incelemesi K1; mimari raporu B4 / §4.1 |
| `tests/server/booking.integration.test.ts` (yeni) | Gerçek PostgreSQL ile 6 entegrasyon testi. | Y6 |
| `.github/workflows/bed4book-v1-server.yml` | PostgreSQL 16 servisi, `npm ci`, migration uygulama, testler; `main` ve `claude/**` dallarında da çalışır. | Y6, K1, K5 |
| `package-lock.json` (yeni), `.gitignore` (yeni), `.env.example` (yeni) | Tekrarlanabilir kurulum. | Y6, D1, K1 |
| `tests/u008-bed4book.js` | İki hatalı test beklentisi: (1) test, aynı eşdeğerlikteki **pahalı** teklifin kazanmasını bekliyordu — en düşük fiyat kuralına göre ucuz olan kazanacak şekilde düzeltildi; (2) gizlilik kontrolü JSON içinde `"B"` harfini arıyordu ama `myBids` alan adı da "B" içerdiği için hiç geçemezdi — rakip `dmcId` ve rakip tutarı aranacak şekilde düzeltildi. Üretim kodu (`u008-bed4book-core.js`) değiştirilmedi. | R-3 |
| `docs/TECHNICAL_ARCHITECTURE_DATA_ROADMAP_TR.md` | Sürüm 2.0: v1 iş akışına göre yeniden yazıldı. | A1-A7, T1-T7, D1-D6, K1-K7 |
| `docs/CLAUDE_TECHNICAL_REVIEW_PROMPT_TR.md` | Değişmedi; yol haritası dalından bu dala kopyalandı. | — |

## Pazarlığa kapalı ürün kuralları (test ederken de geçerli)

1. Rezervasyon tutma/kilitleme yok: arama envantere yazmaz; açık satır kilidi yok; süreli opsiyon yok.
2. Yalnızca en düşük fiyat değerlendirilir: eşdeğerlik anahtarı başına tek kazanan.
3. Kazanan dışında alternatif kullanılmaz: onay başarısızsa başka seçeneğe geçilmez.

Bir düzeltme bu kurallardan birini zayıflatıyorsa bunu **kritik bulgu** olarak raporla.

---

## BÖLÜM A — Komutlarla doğrulama

Boş bir test veri tabanı kullan (testler tabloları `TRUNCATE` eder; gerçek veri tabanına bağlama).

```bash
git clone https://github.com/kosker-07/Book4me.git && cd Book4me
git checkout claude/clever-thompson-awnwcc
node -v                      # 22.x beklenir

# PostgreSQL 16 test veri tabanı (Docker örneği)
docker run -d --name b4b-pg -e POSTGRES_PASSWORD=test -p 5432:5432 postgres:16
sleep 5
psql postgres://postgres:test@localhost:5432/postgres -c "create database bed4book_test"
psql postgres://postgres:test@localhost:5432/bed4book_test -v ON_ERROR_STOP=1 -f server/migrations/001_initial.sql

npm ci
npm run build:server
DATABASE_URL=postgres://postgres:test@localhost:5432/bed4book_test npm run test:server
```

**Beklenen:** `# tests 8`, `# pass 8`, `# fail 0`.

### A1 — Testler gerçekten hatayı yakalıyor mu? (negatif kontrol)

Düzeltmeden önceki `server/app.ts` ile aynı testleri çalıştır:

```bash
git show origin/feature/bed4book-v1-server-foundation:server/app.ts > server/app.ts
DATABASE_URL=postgres://postgres:test@localhost:5432/bed4book_test npm run test:server
git checkout -- server/app.ts
```

**Beklenen:** en az 4 test kırmızı (rezervasyon oluşturma, eşzamanlılık, kısmi düşüm, idempotency). Claude'un yerel ölçümü: `pass 4, fail 4`. Eski kodda testler yeşil çıkıyorsa testler yetersizdir — raporla.

### A2 — CI'da veri tabanı yoksa testler sessizce atlanıyor mu?

```bash
CI=true npm run test:server; echo "exit=$?"
```

**Beklenen:** `exit=1` ve `DATABASE_URL is required for integration tests in CI.` mesajı. Yerelde `DATABASE_URL` olmadan çalıştırınca entegrasyon testleri `skipped` görünür; bu bilinçli bir tercihtir.

### A3 — Eski tarayıcı testleri

```bash
node tests/u008-bed4book.js     # beklenen: "u008 BED4BOOK: all tests passed"
node tests/bed4book.js          # beklenen: "BED4BOOK tests passed"
node tests/unit.js              # beklenen: "26 geçti, 4 kaldı"
```

`tests/unit.js`'deki 4 hata depo dışı bir fikstür yolundan (`/home/user/paket/...`) kaynaklanır ve bu değişiklikle ilgili değildir. Farklı bir sonuç çıkarsa raporla.

### A4 — GitHub Actions

`claude/clever-thompson-awnwcc` dalındaki son commit için "BED4BOOK v1 server checks" iş akışının sonucunu kontrol et. Postgres servisi ayağa kalktı mı, migration uygulandı mı, 8 test geçti mi?

---

## BÖLÜM B — Kod incelemesi

`server/app.ts` içindeki rezervasyon oluşturma bloğunu (`POST /api/agency/bookings`) oku ve şunları cevapla:

1. Envanter satırı için açık kilit (`FOR UPDATE`) kaldı mı? (Beklenen: hayır. Idempotency anahtarı sorgusundaki `FOR UPDATE` envanter değildir ve bu değişikliğin kapsamında değil — bkz. "Bilinen açıklar".)
2. Tek bir gece yetersizse daha önce düşülen geceler geri alınıyor mu? (Beklenen: evet — transaction geri alma; test A1 bunu sınıyor.)
3. Geceler artan tarih sırasıyla mı işleniyor? Neden önemli? (Eşzamanlı transaction'ların satırları aynı sırayla güncellemesi, deadlock riskini azaltır.)
4. `rowCount !== 1` kontrolü, envanter satırı hiç olmayan tarih için de 409 dönüyor mu?
5. Düzeltme ürün kuralı 1'i (kilit yok) zayıflatıyor mu, yoksa güçlendiriyor mu? Gerekçesiyle yaz.

`tests/server/booking.integration.test.ts` dosyasını oku:

6. Testler gerçek PostgreSQL kullanıyor mu (mock yok)?
7. Eşzamanlılık testi gerçekten paralel mi (`Promise.all` ile 20 istek)?
8. "Arama envantere dokunmaz" testi yeterli mi? Eksik gördüğün senaryoyu yaz.

`tests/u008-bed4book.js` değişikliğini oku:

9. Yeni beklenti en düşük fiyat kuralına uygun mu?
10. Yeni gizlilik kontrolü rakip bilgisinin sızmasını gerçekten yakalar mı? Yakalamadığı bir sızıntı şekli var mı?

---

## BÖLÜM C — Yol haritası v2.0 denetimi

`docs/TECHNICAL_ARCHITECTURE_DATA_ROADMAP_TR.md` dosyasını `docs/reviews/CLAUDE_ARCHITECTURE_ROADMAP_REVIEW.md` raporuyla karşılaştır. Her madde için **PASS / FAIL** ver:

| Kontrol | Nerede bakmalı |
|---|---|
| Ürün adı yalnız BED4BOOK | Başlık, tüm metin |
| İş akışı v1'e uygun: Taslak → Beklemede → onay/ret → Onaylandı/Reddedildi/İptal → voucher | §6.3, §6.4 |
| Durum makinesinde `HOLD/HELD/LOCKED/OPTION` yok | §6.4 |
| "Kilit yok" ile "kontenjan aşımı yok" ilişkisi açık ve tek ifadeli atomik düşüm tarif edilmiş | §2.2, §6.5 |
| Onay başarısız olduğunda başka seçeneğe geçilmediği açıkça yazılmış | §2.1, §6.3 |
| Tek kazanan: eşdeğerlik anahtarı, kur eksikse eleme, deterministik tie-break | §2.3 |
| Eksik v1 tabloları eklenmiş: `rate_calendar`, `agency_publications`, `agency_price_rules`, `booking_nights`, `booking_notes`, `vouchers` | §5 |
| Rol ↔ kiracı tipi kısıtı ve ana/alt acente hiyerarşisi | §5.1 |
| Tek backend (PR #2 temeli) ve PostgreSQL 16 | §4.1 |
| Prisma, Redis/BullMQ, React, OTel v1 dışında | §4.1, §10.1 |
| v1 API listesi (yönetim, katalog, takvim, yayın, arama, rezervasyon, Back Office, voucher) | §7 |
| Faz planı v1 Kabul Kriterleri 1-5'e bağlı; voucher ve Back Office fazları var | §10 |
| Rebooking/RateRelay v1 dışı; üç uygulama (u002e, u0030, u008) belirtilmiş | §3.1, §10.1 |
| Kurulum adımları: lockfile, migration çalıştırıcı, DB rolleri, admin CLI, yedek geri yükleme runbook'u, TLS, SMTP | §8.3 |
| Test matrisi kontenjan aşımı, alternatif gizliliği, onay başarısızlığı ve iptal iadesini içeriyor | §11 |
| 10 açık karar "ÖNERİLEN — ONAY BEKLİYOR" olarak işaretli; hiçbiri kesin karar gibi yazılmamış | §13 ve atıf yapılan bölümler |
| Belgedeki "mevcut durum" iddiaları kodla doğru (dosya/satır referanslarını kontrol et) | §3 |

Belgede şartnameyle çelişen, üç ürün kuralından birini zayıflatan veya kodla doğrulanamayan bir iddia bulursan dosya/satır ile raporla.

---

## Bilinen açıklar (Claude bu değişiklikte bilerek yapmadı)

Bunları "eksik" olarak raporlayabilirsin, ama "Claude yaptı ama bozuk" diye sayma:

- Kontenjan **talep anında** düşmeye devam ediyor (PR #2'nin mevcut davranışı). Önerilen "yalnız onay anında düşüm" proje sahibinin kararını bekliyor (yol haritası §13, karar 1).
- Red/iptalde kontenjan iadesi (PR #2 incelemesi K2), fiyat hesabı (K3), eksik v1 uç noktaları (K4), durum makinesi (Y1) ve diğer Y/O/D bulguları henüz düzeltilmedi.
- Idempotency yarış durumu (aynı anahtarla paralel isteklerde 500) düzeltilmedi (O2).
- Eski tarayıcı uygulamasındaki arama eşdeğerliği, kur ve `BK.place` sorunları (C1-C5, B1, B2) ve u008/u0030 üretim kodu hataları (R-2, R-4…R-8) değiştirilmedi.
- `tests/unit.js` depo dışı fikstür bağımlılığı giderilmedi.

---

## Teslim formatı

```
GENEL SONUÇ: ONAY / DÜZELTME GEREKLİ / RED

BÖLÜM A — Komutlar
  A (ana test): <gerçek çıktı özeti: tests/pass/fail>
  A1 (negatif kontrol): <pass/fail sayıları>
  A2 (CI'da DB yok): <exit kodu ve mesaj>
  A3 (eski testler): <her komutun sonucu>
  A4 (GitHub Actions): <sonuç ve bağlantı>

BÖLÜM B — Kod incelemesi
  1-10: <her soru için kısa cevap ve gerekçe>

BÖLÜM C — Yol haritası
  <her kontrol için PASS/FAIL + dosya/bölüm>

YENİ BULGULAR
  <ID | öncelik (Kritik/Yüksek/Orta/Düşük) | dosya:satır | sorun | önerilen düzeltme>

CLAUDE İLE AYRIŞTIĞIM NOKTALAR
  <madde — gerekçe>
```

Çalıştıramadığın bir komutu "geçti" sayma; çalıştıramadığını ve nedenini yaz.
