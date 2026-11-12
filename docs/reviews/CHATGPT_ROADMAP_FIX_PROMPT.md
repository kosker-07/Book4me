# ChatGPT başlatma metni — BED4BOOK mimari yol haritasının düzeltilmesi

Merhaba ChatGPT. BED4BOOK projesinin teknik mimari ve veri yol haritası (`docs/TECHNICAL_ARCHITECTURE_DATA_ROADMAP_TR.md`, dal `docs/technical-architecture-roadmap-2026-11`) Claude tarafından bağımsız olarak denetlendi. Sonuç: **REJECT — bu haliyle v1.0 yol haritası olarak kabul edilmedi.** §2 (değişmez kurallar), §5.6 (veri kuralları) ve §9 (güvenlik) bölümleri korunacak, geri kalanı revize edilecek.

Senden bu bulguları düzeltmeni istiyorum. Claude'un raporunu da körü körüne doğru kabul etme: kodla ve şartnameyle karşılaştır, katılmadığın maddeyi gerekçesiyle yaz.

## Okuman gereken dosyalar

- Denetim raporu: `docs/reviews/CLAUDE_ARCHITECTURE_ROADMAP_REVIEW.md` (dal `claude/clever-thompson-awnwcc`)
- PR #2 kod incelemesi: `docs/reviews/CLAUDE_V1_TECHNICAL_REVIEW.md` ve görev listesi `docs/reviews/CHATGPT_FIX_TASKS.md` (aynı dal)
- Bağlayıcı kapsam: `docs/BED4BOOK_Teknik_Sartname.md`, `docs/BED4BOOK_Proje_Sartnamesi.md`, `docs/IMPLEMENTATION_PLAN_BED4BOOK_V1.md`
- Revize edilecek belge: `docs/TECHNICAL_ARCHITECTURE_DATA_ROADMAP_TR.md`

## Pazarlığa kapalı ürün kuralları

Bu kurallar gevşetilemez, yeniden tasarıma açılamaz:

1. **Rezervasyon tutma/kilitleme yok.** Arama hiçbir envanter kaydına yazmaz. Süreli opsiyon, hold, geçici rezervasyon yoktur. Durum makinesinde `HOLD/HELD/LOCKED/OPTION` bulunmaz. Kontenjan aşımı yalnızca onay anında **tek SQL ifadesiyle atomik koşullu düşüm** ile engellenir (`UPDATE ... WHERE allotment - sold >= :n`); `SELECT ... FOR UPDATE` gibi açık kilit kullanılmaz.
2. **Yalnızca en düşük fiyat değerlendirilir.** Eşdeğerlik anahtarı başına (otel, oda, pansiyon, doluluk, tarihler, iptal sınıfı, ödeme sınıfı, pazar) normalize toplamı en düşük **tek** teklif kazanır. Eşit fiyatta deterministik tie-break uygulanır. Kuru olmayan teklif karşılaştırmaya girmez.
3. **Kazanan dışında alternatif kullanılmaz.** Kaybeden teklifler yanıtta, export'ta ve logda yer almaz. Onay başarısız olursa rezervasyon `Reddedildi` olur; başka fiyat planı, oda, otel veya kaynak denenmez; acente yeni arama yapar.

v1 eşlemesi: v1'de tedarikçi API'si yoktur. "Tedarikçi onayı" = Back Office onayı; "yalnız kazananı yeniden doğrula" = onay anında yalnızca seçilen fiyat planının fiyat ve kontenjanının yeniden kontrolü.

## Çalışma kuralları

- Önce yalnızca **dokümanı** revize et. Kod değişikliği bu görevin ikinci aşamasıdır ve proje sahibinin onayından sonra başlar.
- Main dalına doğrudan gönderme, PR merge etme, mevcut tarayıcı uygulamasını silme.
- Kapsam dışı: tedarikçi API/XML, ödeme/sanal POS, e-fatura, muhasebe, mobil uygulama, Rebooking/RateRelay. Bunlar belgede yalnızca "v1 sonrası — ayrı onay" bölümünde yer alabilir.
- Belgede ürün adı yalnızca **BED4BOOK** olmalı.
- Doğrulamadığın hiçbir şeyi "tamamlandı" veya "PASS" olarak yazma.

---

## AŞAMA 0 — Proje sahibine sor ve onay bekle

Revizyona başlamadan önce aşağıdaki kararları seçenekleriyle birlikte sun. Onay gelmeden bunlardan birini varsayıp belgeye kesin karar olarak yazma (taslakta "KARAR BEKLİYOR" olarak işaretleyebilirsin):

1. **Kontenjan ne zaman düşer?** Önerilen: yalnız Back Office onayı anında (Beklemede talep odayı tutmaz). Alternatif: talep anında (PR #2'nin bugünkü davranışı; kilit yok kuralıyla çelişme riski taşır).
2. **Backend:** PR #2'deki Express 5 + `pg` + SQL migration ile devam mı (önerilen), NestJS'e geçiş mi?
3. **Eşdeğerlik anahtarı:** İptal ve ödeme koşulları dahil mi? (İade edilebilir ve iade edilemez fiyatın aramada birlikte gösterilip gösterilemeyeceği buna bağlı.)
4. **Fiyat modeli:** Net fiyat + acente kuralı (yüzde/sabit) mı, acenteye özel tarihli fiyat mı?
5. **Karşılaştırma para birimi** ve kur kaynağı.
6. **Eşit fiyatta hangi kaynak kazanır?**
7. **Onay sonrası iptal** yetkisi ve kontenjan iadesi politikası.
8. **Back Office kapsamı:** ana acente bazlı mı, platform geneli mi?
9. **PostgreSQL sürümü** (şartname 16 diyor) ve **hosting bölgesi** (Türkiye/AB), KVKK aktarım değerlendirmesi.
10. **Rebooking/RateRelay:** v1 dışı olduğu teyidi; ileride u002e / u0030 / u008'den hangisi esas alınacak?

## AŞAMA 1 — Yol haritası belgesini revize et

Raporun madde kodlarına göre:

**İş akışı ve kapsam (Kritik)**
- **A1:** Hedef akışı v1'e göre yeniden yaz: Taslak → Beklemede → Back Office onay/ret → Onaylandı/Reddedildi/İptal edildi → voucher. Raporun §5.3'teki birleşik durum makinesini kullan; tedarikçi ara durumlarını (`SUPPLIER_PENDING`, `UNKNOWN_OUTCOME_RECONCILIATION`) yalnız "v1 sonrası" olarak ekle.
- **A2 / D1:** Eksik v1 tablolarını ekle: `agency_publications`, `agency_price_rules`, `rate_calendar` (tarih × fiyat planı: net fiyat, allotment, sold, stop-sale), `booking_nights`, `booking_notes`, `vouchers`. Raporun §5.4 DDL taslağını temel al.
- **A3:** "Kilit yok" ile "kontenjan aşımı yok" ilişkisini açıkça yaz (raporun §4.1 tablosu). Test matrisine "N paralel onay, kontenjan K → tam K onay, aşım 0" ve "arama sonrası `sold` değişmemiş" testlerini ekle.
- **A4:** Faz planını raporun §6'daki 11 adımlık sıraya göre yeniden yaz. Voucher ve Back Office fazları mutlaka olsun. Tedarikçi, ödeme/ledger, Redis ve Rebooking/RateRelay "v1 sonrası" bölümüne taşınsın.
- **A5:** Rebooking/RateRelay'i modül listesinden ve v1 test matrisinden çıkar; v1 build'inde devre dışı olduklarını doğrulayan bir test maddesi ekle.
- **A6:** Başlık ve metinde yalnız BED4BOOK.
- **A7:** API taslağını raporun §5.6'daki v1 listesiyle değiştir (yönetim, katalog, takvim, yayın, arama, rezervasyon, Back Office, voucher).

**Teknoloji (Kritik/Yüksek)**
- **T1:** PR #2'yi belgede an; tek backend kararını (Aşama 0, madde 2) yaz. `apps/api` / `server/` çelişkisini gider.
- **T2:** PostgreSQL sürümünü şartnameyle (16) hizala veya onaylanan sürümü gerekçesiyle yaz.
- **T3:** Prisma yerine sürümlü ham SQL migration (isteğe bağlı Kysely); gerekçe: atomik koşullu güncelleme, kısmi unique indeks, RLS, CHECK.
- **T4:** v1'de Redis/BullMQ yok; PostgreSQL outbox + iş tablosu (veya `pg-boss`).
- **T5:** v1'de React yeniden yazımı yok; mevcut ekranlar API'ye bağlanır.
- **T6:** "Yalnız ServerAdapter değişir" iddiasını düzelt: mevcut store tüm veriyi senkron tek JSON belge olarak okuyup yazıyor (`src/core/store.js:44-62`). UI use-case bazlı API çağrılarına geçmeli.
- **T7:** Supabase/hosting için karar kriterleri listesi ekle (bölge, KVKK aktarım dayanağı, PITR, SLA, maliyet). Türkiye bölgesi bulunup bulunmadığını sağlayıcıdan doğrula; varsayma.

**Veri modeli**
- **D2:** `tenants.type` (platform/master/sub), `parent_tenant_id`; rol ↔ kiracı tipi kısıtı DB'de.
- **D3:** Eşdeğerlik anahtarının bileşenlerini ve tie-break'i yaz (`normalized_total ASC`, sonra kaynak id, sonra fiyat planı id).
- **D4:** `token_version` veya `user_sessions`, `login_attempts`, `password_reset_tokens`; eski SHA-256 hash'lerin taşınmayacağını, ilk girişte zorunlu sıfırlama yapılacağını yaz.
- **D5:** Kur yoksa teklif elenir; `winner_quotes.fx_rate_id` zorunlu.
- **D6:** `idempotency_records`'a `request_hash` ve `status` ekle.

**Kurulum adımları**
- **K1–K7:** lockfile + `npm ci`, `.gitignore`, `.env.example`; migration çalıştırıcı + `schema_migrations`; migrator ve runtime DB rolleri; ilk admin CLI; pilot seed (demo verisi değil); yedekten geri yükleme runbook'u; DNS, TLS, HTTP→HTTPS, SMTP + SPF/DKIM/DMARC; logo kaynak dosyasından renk kodları; Postgres'li CI; eski testlerin depo içi fikstürle CI'ye alınması; branch protection; production deploy için manuel onay ve rollback.

**Mevcut durum bölümü (§3) düzeltmeleri**
- Depoda **üç** Rebooking/RateRelay uygulaması (u002e, u0030, u008) olduğunu ve hepsinin pakete derlendiğini yaz (`tools/build.js:13`).
- Arama kodundaki eksikleri yaz: eşdeğerlikte pansiyon yok (`src/domain/search.js:19, 38`), otel kimliği isim metni (`search.js:15`), bilinmeyen kur → 1 (`src/domain/pricing.js:6`), deterministik olmayan tie-break (`search.js:21`).
- `o.hold`'un envanter değil, ön ödeme teminat blokajı olduğunu belirt (`src/domain/accounting.js:49-57`).
- Test durumunu gerçek çıktıyla yaz: `tests/unit.js` 26/30 (4'ü depo dışı fikstür), `tests/u008-bed4book.js` başarısız, `tests/bed4book.js` geçti, tarayıcı testleri doğrulanmadı.

**Aşama 1 kabul kriteri:** Revize belgede v1 Kabul Kriterleri 1–5'in her biri bir faza ve en az bir teste bağlanmış olmalı; üç ürün kuralı her ilgili bölümde (akış, şema, API, test) tutarlı olmalı.

## AŞAMA 2 — Kod (yalnız Aşama 0 onayından ve belge onayından sonra)

Revize yol haritasındaki sıraya göre ilerle. İlk adımlar:

1. Repo hijyeni ve CI (lockfile, Postgres servisli CI, eski testler CI'de).
2. `tests/u008-bed4book.js:7-11` düzelt: test, aynı eşdeğerlikteki **pahalı** teklifin kazanmasını bekliyor ve en düşük fiyat kuralına aykırı. Ya ucuz teklifin eşdeğerliğini farklı yap (geçersiz olduğu için elensin) ya da beklentiyi ucuz teklif yap.
3. PR #2 düzeltmeleri: `docs/reviews/CHATGPT_FIX_TASKS.md`'deki sırayla. **Not:** o listedeki kontenjan düşüm adımları Aşama 0 madde 1 kararına göre uyarlanmalı; onay-anında-düşüm seçilirse `SELECT ... FOR UPDATE` kaldırılıp tek ifadeli atomik koşullu düşüm kullanılmalı.
4. Eski kodda, ilgili faz onaylanırsa: u008 kazanan seçiminde mevcut rezervasyonla eşdeğerlik karşılaştırması (`same()` tanımlı ama kullanılmıyor, `u008:29`); u0030'da onaylanmış yeni rezervasyondan sonra oluşan hatanın `manual_reconciliation` olarak işaretlenmesi (`u0030:118-121`). v1 sırasında yalnız bu modüllerin pakette devre dışı olması yeterli.

Her kod adımında önce hatayı gösteren test, sonra düzeltme; testler gerçek PostgreSQL ile.

---

## Teslim formatı

**Aşama 0 için:** Proje sahibine sorduğun 10 karar ve senin önerin (gerekçesiyle).

**Aşama 1 için:**
```
Revize edilen belge: docs/TECHNICAL_ARCHITECTURE_DATA_ROADMAP_TR.md (sürüm 2.0)
Kapatılan bulgular: A1, A2, ... (her biri için belgedeki bölüm/satır)
Katılmadığım bulgular: <madde — gerekçe>
KARAR BEKLİYOR olarak işaretlenen yerler: <liste>
Değişiklik özeti: <kısa>
```

**Aşama 2'deki her adım için:**
```
Adım: <numara ve başlık>
Düzeltilen bulgular: <...>
Değişen dosyalar: <...>
Komutlar: <...>
Test çıktısı: <gerçek çıktı, kısaltmadan>
Açık kalanlar: <...>
```

Tüm aşamalar bittiğinde Claude, revize belgeyi ve kodu yeniden bağımsız olarak denetleyecek.
