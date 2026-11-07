# BED4BOOK v1.0 — Bağımsız Teknik Kod İncelemesi (Claude)

- **İncelenen dal:** `feature/bed4book-v1-server-foundation` (HEAD `9d2f73a`)
- **Pull Request:** #2 — "BED4BOOK v1: server-side foundation (draft)"
- **İnceleme tarihi:** 7 Kasım 2026
- **Bağlayıcı kaynaklar:** `docs/BED4BOOK_Teknik_Sartname.md`, `docs/BED4BOOK_Proje_Sartnamesi.md`, `docs/IMPLEMENTATION_PLAN_BED4BOOK_V1.md`
- **İncelenen kod:** `server/app.ts`, `server/db.ts`, `server/security.ts`, `server/migrations/001_initial.sql`, `tests/server/security.test.ts`, `package.json`, `tsconfig.server.json`, `.github/workflows/bed4book-v1-server.yml`
- **Kapsam dışı (talimat gereği):** Supplier API/XML, ödeme/sanal POS, e-fatura, muhasebe, mobil uygulama, Rebooking/RateRelay modülü ve tarayıcıdaki eski (legacy) uygulama. Bu alanlar v1.0 teslimatı olarak değerlendirilmedi.

> Bu inceleme sırasında üretim kodunda **hiçbir değişiklik yapılmadı.** Yalnızca bu rapor ve tekrar üretilebilir bir test betiği (`docs/reviews/probes/v1_api_probe.ts`) eklendi.

---

## 0. Yönetici özeti

**Karar: PR #2 bu haliyle merge edilmemeli ve v1.0 kabul kapılarından hiçbirini henüz karşılamıyor.** Mimari yön (Node.js + TypeScript + PostgreSQL, sunucu tarafında yetkilendirme, satır kilitli kontenjan düşümü) şartnameyle uyumlu ve temel güvenlik ilkelerinin bir kısmı doğru uygulanmış. Ancak:

1. **Rezervasyon oluşturma uç noktası her istekte HTTP 500 dönüyor** (`server/app.ts:150`). Gerçek PostgreSQL 16 üzerinde doğrulandı: `could not determine data type of parameter $2` (42P18). Ürünün ana iş akışı çalışmıyor.
2. **CI yeşil**, çünkü testler yalnızca parola özeti ve token imzasını sınıyor; hiçbir API veya veri tabanı testi yok. "CI geçti" bilgisi bu PR'da işlevsel doğruluk hakkında bir şey söylemiyor.
3. Hata (1) yerel kopyada düzeltildiğinde yapılan 25 entegrasyon denemesinde **23 bulgu doğrulandı**; bunların en önemlileri: red/iptalde kontenjan iade edilmiyor, fiyat hesaplaması günlük fiyatı ve para birimini yok sayıyor, pasif acente kullanıcıları giriş yapıp rezervasyon oluşturabiliyor, pasif oda/fiyat planı satılabiliyor, yayın kaydı yanlış otel gösterebiliyor.
4. Olumlu: 20 paralel rezervasyon denemesinde (kontenjan 5) **overbooking oluşmadı** — satır kilitleme stratejisi doğru. Alt acenteler arası rezervasyon izolasyonu temel senaryoda doğru çalışıyor.

| Öncelik | Adet |
|---|---|
| Kritik | 4 |
| Yüksek | 7 |
| Orta | 11 |
| Düşük | 9 |

---

## 1. Yöntem

İnceleme yalnızca okuma ile sınırlı tutulmadı:

1. Üç kaynak belge okundu ve gereksinimler kod ile satır satır eşlendi (bkz. §5 uyum matrisi).
2. `npm install && npm run build:server && npm run test:server` çalıştırıldı → derleme başarılı, 2/2 test geçti.
3. Yerel bir **PostgreSQL 16** kuruldu, `server/migrations/001_initial.sql` uygulandı (hatasız).
4. Gerçek Express uygulaması rastgele bir portta başlatılıp HTTP üzerinden 25 senaryo çalıştırıldı (`docs/reviews/probes/v1_api_probe.ts`).
5. Rezervasyon uç noktası orijinal kodda tamamen bozuk olduğu için, sonraki senaryolar **yalnızca K1 düzeltmesi uygulanmış geçici bir kopya** üzerinde çalıştırıldı (diff aşağıda K1'de). Kopya depoya eklenmedi.

Betik çıktısındaki `CONFIRMED` etiketi "bulgu gerçek veri tabanında yeniden üretildi" anlamına gelir. Raporda bir bulgu yalnızca kod okumasına dayanıyorsa bu açıkça belirtilmiştir.

**Tekrar üretmek için** (yalnızca boş/test veri tabanında — betik tüm tabloları `TRUNCATE` eder):

```bash
createdb b4b_probe && psql -d b4b_probe -f server/migrations/001_initial.sql
PROBE_DATABASE_URL=postgres://.../b4b_probe npx tsx docs/reviews/probes/v1_api_probe.ts
# K1 sonrası senaryolar için: APP_DIR=<K1 düzeltmesi uygulanmış server/ kopyası>
```

---

## 2. Bulgu özeti

| ID | Öncelik | Başlık | Konum | Doğrulama |
|---|---|---|---|---|
| K1 | **Kritik** | Rezervasyon oluşturma her zaman 500 dönüyor (kullanılmayan `$2` parametresi) | `server/app.ts:150` | Gerçek DB ✔ |
| K2 | **Kritik** | Red/iptal edilen rezervasyonun kontenjanı iade edilmiyor | `server/app.ts:183-205` | Gerçek DB ✔ |
| K3 | **Kritik** | Fiyat hesabı günlük fiyatı ve fiyat planı para birimini yok sayıyor; satış fiyatı tarih boyutsuz | `server/app.ts:131-153`, `001_initial.sql:59-80` | Gerçek DB ✔ |
| K4 | **Kritik** | v1 zorunlu modülleri yok: otel aktivasyonu, oda/fiyat/kontenjan, yayınlama, kullanıcı yönetimi, voucher, acentenin kendi rezervasyonları | `server/app.ts` (genel) | Gerçek DB ✔ (P17) |
| Y1 | Yüksek | "Taslak" durumu yok; durum makinesi eksik (onaylı rezervasyon iptal edilemiyor, alt acente iptal edemiyor) | `001_initial.sql:93`, `server/app.ts:187-196` | Gerçek DB ✔ |
| Y2 | Yüksek | Pasif acentenin kullanıcıları giriş yapıp rezervasyon oluşturabiliyor | `server/app.ts:17-32, 46-61, 131-137` | Gerçek DB ✔ |
| Y3 | Yüksek | Yayın kaydı (`agency_hotel_sales`) tutarsız olabilir; liste ile rezervasyon farklı otelleri baz alıyor | `001_initial.sql:70-80`, `server/app.ts:106-112` | Gerçek DB ✔ |
| Y4 | Yüksek | Pasif oda/fiyat planı satılabiliyor; liste geçerli tarih/fiyat/kontenjan kontrolü yapmıyor | `server/app.ts:106-112, 131-137` | Gerçek DB ✔ |
| Y5 | Yüksek | Rol ↔ acente tipi ilişkisi zorlanmıyor; otel bir alt acenteye ait olabiliyor | `001_initial.sql:11-20, 22-24`, `server/app.ts:88` | Gerçek DB ✔ |
| Y6 | Yüksek | Test kapsamı ve CI işlevsel doğruluğu hiç sınamıyor; lockfile yok | `tests/server/*`, `.github/workflows/bed4book-v1-server.yml` | Gözlem ✔ |
| Y7 | Yüksek | Girişte kaba kuvvet koruması, giriş denetim kaydı ve kullanıcı sayımı (enumeration) koruması yok | `server/app.ts:46-61` | Kod okuması |
| O1 | Orta | Geçersiz girdiler 400 yerine 500 dönüyor; `NaN` gece sayısı kontenjan döngüsünü atlıyor; geçmiş tarih kabul | `server/app.ts:123-142, 185` | Gerçek DB ✔ |
| O2 | Orta | Idempotency yarış durumunda 500; anahtar istek içeriğine bağlı değil | `server/app.ts:129-162` | Gerçek DB ✔ |
| O3 | Orta | `booking_no` zaman damgasından türetiliyor; çakışma ve tahmin edilebilirlik | `server/app.ts:152` | Kod okuması |
| O4 | Orta | E-posta benzersizliği büyük/küçük harf duyarlı | `001_initial.sql:14`, `server/app.ts:52` | Gerçek DB ✔ |
| O5 | Orta | RLS yok; `app.agency_id` ayarlanıyor ama hiçbir politika kullanmıyor | `server/db.ts:234`, migration | Gerçek DB ✔ |
| O6 | Orta | Misafir/konaklama verisi voucher ve operasyon için yetersiz (yetişkin/çocuk, operasyon notu) | `001_initial.sql:82-100`, `server/app.ts:123-126` | Kod okuması |
| O7 | Orta | Denetim kayıtları eksik ve yanlış acenteyi işaretliyor | `server/app.ts:37-42, 200` | Gerçek DB ✔ |
| O8 | Orta | Oturum iptali/çıkış yok; token saklama stratejisi tanımsız | `server/security.ts`, `server/app.ts:58` | Kod okuması |
| O9 | Orta | Hata yönetimi: ayrıştırıcı mesajı sızıyor, FK/CHECK ihlalleri 500, rollback hatası orijinal hatayı gizliyor | `server/app.ts:207-211`, `server/db.ts:238-240` | Gerçek DB ✔ |
| O10 | Orta | Migration çalıştırıcı ve ilk yönetici oluşturma aracı yok | repo geneli | Gözlem ✔ |
| O11 | Orta | HTTP sertleştirme yok (güvenlik başlıkları, CORS, proxy/HTTPS, graceful shutdown) | `server/app.ts:6-8, 213-217` | Kod okuması |
| D1–D9 | Düşük | İndeksler, para hesabı, scrypt parametreleri, .gitignore, marka metinleri vb. | bkz. §3.4 | — |

---

## 3. Ayrıntılı bulgular

### 3.1 Kritik

#### K1 — Rezervasyon oluşturma her istekte HTTP 500 dönüyor

- **Konum:** `server/app.ts:150`
  ```ts
  await client.query("UPDATE inventory_daily SET reserved=reserved+$3 WHERE id=$1 AND allotment-reserved >= $3",
                     [inventory.rows[0].id, date, rooms]);
  ```
- **Sorun:** Sorgu `$1` ve `$3` kullanıyor, `$2` (`date`) hiç geçmiyor. PostgreSQL, tipini çıkaramadığı kullanılmayan parametre için sorguyu reddeder: `ERROR 42P18: could not determine data type of parameter $2`. Transaction geri alınır, istemci `500 INTERNAL_SERVER_ERROR` alır.
- **Doğrulama:** Probe P1, orijinal kod: `{"status":500,"body":{"error":"INTERNAL_SERVER_ERROR"}}`, sunucu logunda 42P18.
- **Neden önemli:** Teknik Şartname §4.3 ve Kabul Kriteri 2 ("Alt acente rezervasyon oluşturur") tamamen engelleniyor. Commit mesajlarında "transactional booking" olarak sunulan özellik hiç çalıştırılmadan teslim edilmiş. Ayrıca CI'nin bunu yakalamaması Y6'nın somut kanıtı.
- **Çözüm:**
  ```ts
  const upd = await client.query(
    "UPDATE inventory_daily SET reserved = reserved + $2 WHERE id = $1 AND allotment - reserved >= $2",
    [inventory.rows[0].id, rooms]);
  if (upd.rowCount !== 1) throw Object.assign(new Error("ALLOTMENT_UNAVAILABLE"), { status: 409 });
  ```
  Bu inceleme için geçici kopyaya uygulanan diff yalnızca parametre listesinden `date`'i çıkarıp `$3`→`$2` değiştirmektir.
- **Test senaryosu:** Aktif otel + fiyat planı + 2 gecelik kontenjan + alt acente yayını kur; `POST /api/agency/bookings` → 201 ve `inventory_daily.reserved` her gece için +1 bekle. Bu test gerçek PostgreSQL ile CI'de koşmalı.

#### K2 — Red veya iptalde kontenjan iade edilmiyor

- **Konum:** `server/app.ts:183-205` (durum güncelleme), ilişkili `server/app.ts:143-151`
- **Sorun:** Durum `rejected` veya `cancelled` yapıldığında yalnızca `bookings.status` güncelleniyor; `inventory_daily.reserved` geri azaltılmıyor. Reddedilen her rezervasyon kontenjanı kalıcı olarak tüketiyor.
- **Doğrulama:** P5: red öncesi `reserved` toplamı 2, sonrası 2. P6b: kontenjan 2 olan bir tarihte bir reddedilmiş + bir onaylanmış rezervasyon sonrası yeni talep `409 ALLOTMENT_UNAVAILABLE` alıyor; gerçekte 1 oda boş.
- **Neden önemli:** Kabul Kriteri 4 ve Canlıya Geçiş Kapısı "kontenjan aşımı kontrolleri çalışıyor" doğruluk gerektirir — hayalet doluluk (phantom sell-out) satış kaybı demektir. Uygulama planı bunu "tamamlanmadı" diye not etmiş, ancak K1 düzeltildiği anda veri bozulmaya başlayacağı için kritik.
- **Çözüm:**
  1. Rezervasyonun hangi gece/hangi envanter satırından ne kadar düştüğünü kalıcı tutun: `booking_nights(booking_id, inventory_daily_id, stay_date, rooms, net_price, sell_price)`.
  2. `pending|approved → rejected|cancelled` geçişinde aynı transaction içinde ilgili `inventory_daily` satırlarını **tarih sırasıyla** `FOR UPDATE` kilitleyip `reserved = reserved - rooms` yapın.
  3. İade işlemini tek bir fonksiyonda toplayın, idempotent olsun (aynı rezervasyon iki kez iade edilemesin — durum kontrolü kilit altında yapılıyor, bu yeterli).
- **Test senaryosu:** Kontenjan 1; rezervasyon oluştur (reserved=1) → reddet → reserved=0 → yeni rezervasyon 201. Aynısını `approved → cancelled` için de koşun.

#### K3 — Fiyat hesabı şartnameye aykırı: günlük fiyat ve para birimi yok sayılıyor

- **Konum:** `server/app.ts:131-136, 153`; `server/migrations/001_initial.sql:48-57, 59-67, 70-80`
- **Sorun:**
  - Toplam tutar `sell_price × rooms × nights` ile hesaplanıyor. `inventory_daily.price` (tarih bazlı fiyat) hiçbir yerde kullanılmıyor.
  - `agency_hotel_sales.sell_price` fiyat planı başına **tek bir sabit sayı**; tarih/sezon boyutu yok. Teknik Şartname §4.1 "Fiyat ve kontenjan; tarih aralığı, oda tipi, pansiyon ... göre yönetilmelidir" ifadesiyle çelişiyor.
  - `rate_plans.currency` (ör. EUR) ile `agency_hotel_sales.sell_currency` (ör. TRY) arasında tutarlılık kontrolü yok; rezervasyon fiyat planından farklı para biriminde yazılabiliyor.
  - Rezervasyona gecelik fiyat dökümü (snapshot) kaydedilmiyor; sonradan fiyat değişirse tutarın kaynağı izlenemez.
- **Doğrulama:** P2: günlük fiyatlar 100 + 200 EUR, acente satış fiyatı 50 TRY → rezervasyon toplamı `100 TRY` (= 50 × 2 gece). Beklenen: tarih bazlı fiyatlardan türetilmiş tutar, doğru para biriminde.
- **Neden önemli:** Kabul Kriteri 1 "seçtiği alt acente bu oteli ve **doğru fiyatı** görür". Yanlış tutar ticari bir B2B platformda doğrudan mali kayıp/uyuşmazlık demektir.
- **Çözüm (iş sahibinin onaylaması gereken bir model kararı):** İki makul seçenek:
  - **A — Markup modeli:** `inventory_daily.price` net fiyattır; `agency_hotel_sales` yüzde/sabit markup tutar (`markup_type`, `markup_value`). Satış fiyatı = Σ(günlük net) uygulanmış markup.
  - **B — Acenteye özel tarihli fiyat:** `agency_rate_prices(agency_id, rate_plan_id, date_from, date_to, sell_price)` tablosu; her gece için eşleşen satır zorunlu, yoksa satılamaz.

  Her iki durumda: para birimi `rate_plans.currency` ile sabitlenmeli (veya açık kur politikası tanımlanmalı), hesap SQL `numeric` ile yapılmalı (D6) ve `booking_nights` tablosuna gecelik net/satış fiyatı yazılmalı.
- **Test senaryosu:** 3 gece, günlük 100/200/300, acente A için %10 markup, acente B için %20 → A toplam 660, B toplam 720; A'nın yanıtında B'nin fiyatı yer almamalı.

#### K4 — v1.0 zorunlu modülleri mevcut değil

Uygulama planı bunların bir kısmını "Not yet complete" olarak listeliyor; ancak şartname kabul kriterleri açısından ürün şu an uçtan uca **hiçbir** senaryoyu çalıştıramıyor. Özellikle:

| Eksik | Etki | Şartname |
|---|---|---|
| Otel durumunu `draft → active/inactive` yapan uç nokta yok | API ile oluşturulan otel **asla aktif olamaz**, dolayısıyla hiçbir acente göremez/satamaz | §4.1 |
| Oda, pansiyon/fiyat planı, günlük fiyat/kontenjan (toplu tarih aralığı) CRUD | Envanter yalnızca doğrudan SQL ile girilebilir | §4.1, Kabul 1 |
| Acente bazlı yayınlama (`agency_hotel_sales`) CRUD | Ürün acenteye açılamaz | §4.2 |
| Kullanıcı oluşturma / parola atama / rol değişikliği | `hashPassword` var ama hiçbir yerden çağrılmıyor; ilk kullanıcı bile oluşturulamıyor | §3, §7 |
| Alt acentenin kendi rezervasyonlarını listeleme ve detay (`GET /api/agency/bookings`, `/:id`) | "Kendi rezervasyonlarını takip etme" yok (P17: 404) | §3, Proje §3 |
| Back Office rezervasyon detayı, işlem geçmişi görüntüleme, operasyon notu, değişiklik | Kuyruk yalnızca özet satır döndürüyor | Proje §4 |
| PDF voucher üretme ve indirme | Kabul 2'nin son adımı yok | §4.4, Kabul 2 |
| Otel görselleri için erişim kontrollü dosya depolama | `images` serbest JSON | §5 |
| Arama (tarih, konum, kişi sayısına göre müsaitlik) | Liste uç noktası tarih almıyor | §4.2 |

- **Çözüm:** Aşağıdaki §6 yol haritasında önerilen sırayla, her modül için önce entegrasyon testi yazılarak tamamlanmalı. Voucher için öneri: `pdfkit` veya `pdf-lib` ile sunucu tarafında üretim; yalnızca `approved` durumda; erişim — rezervasyonu yapan alt acente, otelin ana acentesi, back office ve sistem yöneticisi; üretilen dosya hash'i ve üretim olayı audit'e yazılmalı; logo kaynak dosyasından (renkler tahmin edilmeden) gömülmeli.

### 3.2 Yüksek

#### Y1 — "Taslak" durumu yok; durum makinesi eksik

- **Konum:** `server/migrations/001_initial.sql:93`, `server/app.ts:187-196`
- **Sorun:**
  - Şartname §4.3: durumlar "en azından **Taslak, Beklemede, Onaylandı, Reddedildi ve İptal edildi**". CHECK kısıtı `draft` içermiyor.
  - Tek izinli geçiş `pending → approved|rejected|cancelled`. Onaylanmış rezervasyon **iptal edilemiyor** (P6: `409 INVALID_STATUS_TRANSITION`). Gerçek operasyonda en sık iptal onaydan sonra gelir.
  - Alt acentenin kendi rezervasyonunu iptal etme yolu yok.
  - İzin verilen değişiklik (Proje §3 "izin verilen değişikliği yapar") için akış yok.
- **Çözüm:** Açık bir geçiş tablosu tanımlayın ve kod + DB'de tek kaynaktan uygulayın:
  ```
  draft    → pending (acente gönderir) | cancelled
  pending  → approved | rejected | cancelled
  approved → cancelled
  ```
  `rejected/cancelled` geçişleri K2'deki iadeyi tetiklemeli. Hangi rolün hangi geçişi yapabileceği (ör. alt acente yalnızca kendi `draft|pending` rezervasyonunu iptal) iş sahibinin onayıyla yazılmalı (Şartname §10 "onay ve iptal politikaları" açık karar).
- **Test:** Her geçiş için izinli/izinsiz matris testi; `approved → cancelled` sonrası kontenjan iadesi.

#### Y2 — Pasif acentenin kullanıcıları erişmeye devam ediyor

- **Konum:** `server/app.ts:17-32` (`authenticate`), `46-61` (login), `131-137` (satış sorgusu)
- **Sorun:** `agencies.active` hiçbir sorguda kontrol edilmiyor. Acenteyi pasifleştirmek kullanıcılarını durdurmuyor.
- **Doğrulama:** P9: `agencies.active=false` sonrası giriş `200`, rezervasyon `201`.
- **Çözüm:** `authenticate` ve login sorgularına `LEFT JOIN agencies a ON a.id=u.agency_id ... AND (u.agency_id IS NULL OR a.active)` ekleyin; satış sorgusuna `JOIN agencies sa ON sa.id=s.agency_id AND sa.active` ve otelin sahibi acentenin aktifliğini ekleyin.
- **Test:** Acenteyi pasifleştir → mevcut token ile `/api/me` 401, login 401, rezervasyon 401/403.

#### Y3 — Yayın kaydı tutarsız olabilir; liste ve rezervasyon farklı kaynakları baz alıyor

- **Konum:** `server/migrations/001_initial.sql:70-80`, `server/app.ts:106-112` ve `131-136`
- **Sorun:** `agency_hotel_sales` hem `hotel_id` hem `rate_plan_id` tutuyor ama ikisinin aynı otele ait olduğunu zorlayan bir kısıt yok. Liste `s.hotel_id` üzerinden, rezervasyon `rate_plan → room → hotel` üzerinden join yapıyor. Ayrıca `agency_id`'nin bir **alt acente** olduğu zorlanmıyor.
- **Doğrulama:** P11: Otel H'nin fiyat planı için `hotel_id = "Decoy Hotel"` ile yayın satırı kabul edildi; alt acente B'nin listesinde "Decoy Hotel" görünüyor, rezervasyon ise H'ye yazılacak.
- **Neden önemli:** Yayın uç noktası henüz yazılmadığı için şimdi düzeltmek ucuz. Aksi halde acente yanlış oteli görüp başka bir otele rezervasyon yapabilir; başka bir ana acentenin oteli yanlışlıkla/kasıtlı yayınlanabilir.
- **Çözüm:** `hotel_id` sütununu kaldırıp oteli her zaman `rate_plan → room → hotel` üzerinden türetin; ya da `rooms(id, hotel_id)` ve `rate_plans(id, room_id, hotel_id)` üzerinde bileşik FK ile tutarlılığı zorlayın. Yayın uç noktası, yayını yapanın otelin `owner_agency_id`'si olduğunu ve hedef acentenin `type='sub'` ve aktif olduğunu kontrol etmeli.
- **Test:** Ana acente M2, M1'in fiyat planını kendi alt acentesine yayınlamaya çalışır → 403/404.

#### Y4 — Pasif oda/fiyat planı satılabiliyor; liste geçerlilik kontrolü yapmıyor

- **Konum:** `server/app.ts:106-112`, `131-137`
- **Sorun:** Satış sorgusu `rooms.active` ve `rate_plans.active` kontrol etmiyor. Liste sorgusu yalnızca yayın + otel aktifliğine bakıyor; şartname §4.2 "yalnızca kendisine satışa açılmış **ve geçerli tarih/fiyat/kontenjanı bulunan** ürünleri" diyor.
- **Doğrulama:** P10: oda ve fiyat planı pasif → rezervasyon `201`. P11b: hiç `inventory_daily` satırı olmayan otel listede görünüyor.
- **Çözüm:** Satış sorgusuna `AND r.active AND rp.active` ekleyin. Liste/arama uç noktası `checkIn/checkOut/rooms` alıp yalnızca tüm geceler için `allotment - reserved >= rooms` olan fiyat planlarını döndürmeli (ve acenteye ait satış fiyatını hesaplayarak — K3).
- **Test:** Pasif fiyat planı → 404; kontenjanı olmayan tarih aralığı için arama sonucunda otel yok.

#### Y5 — Rol ↔ acente tipi zorlanmıyor; otel bir alt acenteye ait olabiliyor

- **Konum:** `server/migrations/001_initial.sql:11-20` (users), `22-24` (hotels), `server/app.ts:88`
- **Sorun:**
  - `users` CHECK yalnızca "system_admin ise agency_id NULL" kuralını uyguluyor. `master_agency` rolündeki bir kullanıcı **alt acenteye**, `sub_agency` rolündeki bir kullanıcı **ana acenteye** bağlanabiliyor (P1 öncesi: "weird" kullanıcı giriş yaptı).
  - Sistem yöneticisi otel oluştururken `ownerAgencyId` doğrulanmıyor: var olmayan acente → 500 (P14); **alt acente sahibi otel** → 201 (P14b).
  - Bunun sonucu: alt acentenin altında açılmış bir `master_agency` kullanıcısı otel oluşturabilir ve o "otelin" Back Office kuyruğunu görebilir; izolasyon modeli tip bilgisine dayanmadığı için yanlış yapılandırma doğrudan yetki genişlemesine dönüşür.
- **Çözüm:** Kullanıcı oluşturma uç noktasında (henüz yok — K4) ve DB'de tetikleyici veya bileşik FK ile: `master_agency/back_office → agencies.type='master'`, `sub_agency → agencies.type='sub'`. `hotels.owner_agency_id` yalnızca `type='master'` olabilir. Sistem yöneticisi girdisinde acentenin varlığı ve tipi kontrol edilip 400/404 dönülmeli.
- **Not — Back Office kapsamı:** Mevcut modelde `back_office` kullanıcısı yalnızca kendi ana acentesinin otellerine ait rezervasyonları görüyor. Platform genelinde çalışan bir operasyon ekibi isteniyorsa bu bir iş kararıdır; şartname §3 "rol kapsamı içinde" diyor. İş sahibinin netleştirmesi önerilir.

#### Y6 — Testler ve CI işlevsel doğruluğu sınamıyor

- **Konum:** `tests/server/security.test.ts`, `.github/workflows/bed4book-v1-server.yml`, `package.json`
- **Sorun:**
  - Yalnızca 2 birim testi var (parola özeti, token imzası). API, DB, yetkilendirme, izolasyon, eşzamanlılık testi yok. K1 gibi uç noktayı tamamen bozan bir hata CI'den yeşil geçti (PR #2 check run'ları: 2/2 success).
  - CI'de PostgreSQL servisi yok, migration uygulanmıyor.
  - `package-lock.json` yok; CI `npm install` ile her seferinde farklı bağımlılık sürümleri çözebilir (tekrarlanabilir derleme ve tedarik zinciri riski).
  - `push` tetikleyicisi yalnızca feature dalı için tanımlı; `main`'e merge sonrası bu iş koşmaz.
  - Mevcut tarayıcı uygulaması testleri (`node tests/unit.js` vb.) CI'ye bağlı değil; uygulama planı bunların bu dalda geçtiğinin doğrulanmadığını kendisi belirtiyor.
- **Neden önemli:** Teknik Şartname §8: "Başarısız test düzeltilmeden sonraki aşamaya geçilmemelidir" ve Kabul 3–4 (izolasyon, eşzamanlılık) otomatik testle kanıtlanmalı.
- **Çözüm:**
  1. `package-lock.json` commit edin; CI'de `npm ci`.
  2. Workflow'a `services: postgres: image: postgres:16` ekleyin; migration'ı uygulayıp entegrasyon testlerini koşun.
  3. En az şu entegrasyon testleri: login/401/403 matrisi; iki alt acente izolasyonu (liste, fiyat, rezervasyon, detay, voucher); 20+ paralel rezervasyon ile kontenjan; aynı idempotency anahtarıyla paralel istek; red/iptal iadesi; durum geçiş matrisi; pasif acente/kullanıcı.
  4. `push` tetikleyicisine `main` ekleyin; branch protection ile PR'da zorunlu kılın.
  5. Bu rapordaki `docs/reviews/probes/v1_api_probe.ts` betiği başlangıç noktası olarak kullanılabilir (test çatısına taşınmalı, betik olarak bırakılmamalı).

#### Y7 — Giriş uç noktasında kaba kuvvet ve kullanıcı sayımı koruması yok

- **Konum:** `server/app.ts:46-61`
- **Sorun (kod okuması):**
  - Hız sınırı / hesap kilitleme / gecikme yok; parola tahmini sınırsız.
  - Başarılı/başarısız giriş denetim kaydına yazılmıyor (§7 "Hassas işlemler denetim kayıtlarına yazılmalıdır").
  - Kullanıcı yoksa scrypt çalışmıyor, varsa çalışıyor → yanıt süresi farkıyla e-posta varlığı anlaşılabilir.
- **Çözüm:** IP + e-posta bazlı hız sınırlama (ör. `express-rate-limit` ve kalıcı sayaç), N başarısız denemeden sonra artan gecikme/geçici kilit; kullanıcı yoksa sahte bir hash'e karşı `verifyPassword` çalıştırarak sabit süre; `auth.login.success/failure` olaylarını IP ve user-agent ile audit'e yazın.
- **Test:** Aynı e-postaya 20 hatalı denemeden sonra 429; var olan/olmayan e-posta yanıt süreleri istatistiksel olarak ayırt edilemez.

### 3.3 Orta

#### O1 — Girdi doğrulama: 500 hataları, `NaN` ile kontenjan döngüsünün atlanması, geçmiş tarih

- **Konum:** `server/app.ts:123-142`, `185`
- **Doğrulama:**
  - P4a: `ratePlanId: "not-a-uuid"` → 500 (PostgreSQL 22P02).
  - P4d: `PATCH /api/backoffice/bookings/xyz/status` → 500.
  - P4b: `checkIn: "2027-13-01"` regex'i geçiyor, `Date.parse` `NaN` veriyor; `NaN < 1` ve `NaN > 60` ikisi de `false` olduğu için gece kontrolü geçiliyor, `for (i < NaN)` döngüsü hiç çalışmıyor, yani **kontenjan kontrolü tamamen atlanıyor**. Rezervasyonu yalnızca PostgreSQL'in tarihi reddetmesi (500) engelliyor — güvenlik bir tesadüfe dayanıyor.
  - `2027-02-30` V8'de sessizce `2027-03-02`'ye kayıyor; uygulama ve DB farklı tarihleri yorumlayabiliyor.
  - P4e: geçmiş tarihli giriş doğrulama hatası değil, kontenjan hatası alıyor; geçmiş tarihli envanter satırı varsa rezervasyon oluşur.
  - `rooms` üst sınırı yok; `guest.firstName` nesne/çok uzun metin olabiliyor; `guest.email` format kontrolü yok.
- **Çözüm:** Şema tabanlı doğrulama (ör. `zod`): UUID, gerçek takvim tarihi (`YYYY-MM-DD` parse edip yeniden formatlayınca aynı olmalı), `checkIn >= bugün` (otel saat dilimine göre), `1 ≤ rooms ≤ 10`, metin uzunluk sınırları, e-posta formatı. `Number.isFinite(nights)` açık kontrolü. Doğrulama hataları 400 + alan bazlı mesaj.
- **Test:** Her geçersiz girdi için 400; hiçbir girdi 500 üretmemeli (basit fuzz testi).

#### O2 — Idempotency yarışı ve içerik bağımsızlığı

- **Konum:** `server/app.ts:129-130, 162`
- **Sorun:** Var olmayan bir satır için `SELECT ... FOR UPDATE` hiçbir şey kilitlemez. Aynı anahtarla eş zamanlı gelen istekler hepsi işleme girer; ilki dışındakiler `idempotency_keys` PK ihlaliyle 500 alır. Ayrıca aynı anahtar farklı içerikle tekrar gönderildiğinde eski yanıt sessizce dönüyor.
- **Doğrulama:** P8: 5 paralel istek → `500,500,500,500,201` (yalnızca 1 rezervasyon kalıcı — veri doğru, yanıt yanlış). P8c: aynı anahtar, `rooms: 3` → eski `rooms: 1` yanıtı 201 ile döndü.
- **Çözüm:** Transaction başında `INSERT INTO idempotency_keys(agency_id,key,request_hash,status) VALUES (...,'in_progress') ON CONFLICT DO NOTHING` ile anahtarı "rezerve edin"; çakışmada mevcut satırı `FOR UPDATE` ile bekleyip yanıtı döndürün. `request_hash` (gövdenin SHA-256'sı) farklıysa `422 IDEMPOTENCY_KEY_REUSED`. Anahtarlara saklama süresi (ör. 24 saat) ve temizlik işi.
- **Test:** Aynı anahtarla 10 paralel istek → hepsi aynı 201 gövdesi, 1 rezervasyon; farklı gövde → 422.

#### O3 — `booking_no` zaman damgasından türetiliyor

- **Konum:** `server/app.ts:152` — `B4B-${Date.now().toString(36).toUpperCase()}`
- **Sorun (kod okuması):** Aynı milisaniyede oluşan iki rezervasyon aynı numarayı alır → UNIQUE ihlali → 500. P7'de 20 paralel istekte çakışma gözlenmedi (kilitler istekleri serileştiriyor), ancak farklı fiyat planlarında paralel rezervasyonlar kilitlenmediği için risk gerçek. Numara ayrıca tahmin edilebilir ve oluşturma zamanını sızdırır.
- **Çözüm:** PostgreSQL `SEQUENCE` + biçimlendirme (ör. `B4B-2026-000123`) veya kısa rastgele kimlik + UNIQUE çakışmada yeniden deneme.

#### O4 — E-posta benzersizliği büyük/küçük harf duyarlı

- **Konum:** `server/migrations/001_initial.sql:14`, `server/app.ts:52`
- **Doğrulama:** P12: `a@x.test` varken `A@X.TEST` başka bir acenteye eklenebildi. Login `lower(email) = $1 LIMIT 1` sırasız olduğu için hangi hesabın açılacağı belirsiz.
- **Çözüm:** `CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));` (veya `citext`), kullanıcı oluştururken e-postayı normalize edin.

#### O5 — Satır düzeyi güvenlik (RLS) yok

- **Konum:** `server/db.ts:234`, migration
- **Sorun:** `withTransaction` `app.agency_id` ayarlıyor ama hiçbir tabloda RLS politikası yok (P16: `pg_policies` = 0). `pool.query` ile yapılan okumalar (liste, kuyruk) bu ayarı hiç almıyor. Kodda RLS varmış izlenimi oluşuyor.
- **Neden önemli:** Şartname zorunlu olarak RLS istemiyor; uygulama katmanı filtreleri şu an doğru (P3/P3b). Ancak acente izolasyonu ürünün en kritik güvenlik özelliği; tek bir unutulmuş `WHERE` tüm veriyi açar. Derinlemesine savunma önerilir.
- **Çözüm:** Ya `set_config` çağrısını kaldırıp yanıltıcılığı giderin ya da: uygulama için ayrı, `BYPASSRLS` olmayan bir DB rolü; `bookings`, `agency_hotel_sales`, `idempotency_keys` üzerinde `agency_id = current_setting('app.agency_id')::uuid` (alt acente) politikaları; tüm sorguları bağlam ayarlayan bir yardımcıdan geçirin. Sistem yöneticisi için ayrı açık bayrak.

#### O6 — Misafir ve konaklama verisi yetersiz

- **Konum:** `server/migrations/001_initial.sql:82-100`, `server/app.ts:123-126`
- **Sorun (kod okuması):** Yalnızca tek misafir adı/soyadı ve isteğe bağlı e-posta tutuluyor. Yetişkin/çocuk sayısı, çocuk yaşları, oda başına misafir listesi, telefon, uyruk (otel bildirimi için sık gerekli), özel istek ve **operasyon notu** yok. `rooms.max_adults/max_children` hiçbir yerde doğrulanmıyor.
- **Neden önemli:** Şartname §4.3 "misafir bilgilerinin alınması", §4.4 voucher üzerinde "misafir ve **operasyon notları**" zorunlu.
- **Çözüm:** `booking_guests(booking_id, room_index, first_name, last_name, type adult/child, age)` ve `bookings.operation_notes`, `bookings.agency_reference`, `bookings.special_requests` alanları; kapasite doğrulaması. Kişisel veri alanları KVKK değerlendirmesiyle sınırlandırılmalı (§7).

#### O7 — Denetim kayıtları eksik ve yanlış bağlam taşıyor

- **Konum:** `server/app.ts:37-42`, `200`; `001_initial.sql:114-122`
- **Doğrulama:** P15: rezervasyon reddinde audit satırının `agency_id` alanı **işlemi yapan ana acente**; rezervasyonun ait olduğu alt acente kaydedilmiyor. Sistem yöneticisi işlemlerinde `NULL`.
- **Sorun:** Önceki/sonraki değer, IP, user-agent, istek kimliği yok; giriş/başarısız giriş, kullanıcı/rol değişikliği, fiyat/kontenjan değişikliği, yayın değişikliği, voucher indirme olayları yok. `audit_logs` uygulama tarafından güncellenip silinebilir.
- **Çözüm:** `audit_logs`'a `target_agency_id`, `before jsonb`, `after jsonb`, `ip inet`, `user_agent`, `request_id` ekleyin; uygulama DB rolüne yalnızca `INSERT` yetkisi verin (değiştirilemezlik). Şartname §7'de sayılan hassas işlemlerin listesini netleştirip her birine test yazın.

#### O8 — Oturum yönetimi

- **Konum:** `server/security.ts:20-41`, `server/app.ts:17-32, 58`
- **Olumlu:** Her istekte kullanıcı DB'den doğrulanıyor (aktiflik, rol, acente) — kullanıcı pasifleştirme anında etkili.
- **Sorun (kod okuması):** Çıkış (logout) ve parola değişiminde token iptali yok; 8 saatlik token sızarsa süresi dolana kadar geçerli. Token'ın tarayıcıda nerede saklanacağı tanımlı değil; şartname §5 "veri tarayıcıda kalıcı tutulmaz" diyor, `localStorage`'da bearer token XSS'e açıktır. `Bearer ` öneki olmadan gönderilen değer de kabul ediliyor (D4).
- **Çözüm:** `users.token_version` (veya `sessions` tablosu) ve token'a `ver` alanı; logout/parola değişiminde artırma. Tarayıcı için `HttpOnly; Secure; SameSite=Strict` çerez + CSRF koruması tercih edilmeli.

#### O9 — Hata yönetimi

- **Konum:** `server/app.ts:207-211`, `server/db.ts:238-240`
- **Doğrulama:** P13: bozuk JSON → `400 {"error":"Expected property name or '}' in JSON at position 1 ..."}` (iç ayrıştırıcı mesajı istemciye sızıyor). P14: FK ihlali → 500. `CHECK (reserved <= allotment)` ihlali (kontenjanı rezerve edilenin altına indirme) ileride 500 olarak dönecek.
- **Sorun:** `ROLLBACK` başarısız olursa orijinal hata kaybolur ve bozuk bağlantı havuza geri döner (`client.release()` hata ile çağrılmıyor). Yapılandırılmış log, istek kimliği ve hata kodu sözlüğü yok (§8 "hata kayıtları" kabul kriteri).
- **Çözüm:** Hata sınıfları (`ValidationError`, `NotFound`, `Conflict`) ve PostgreSQL kodu eşlemesi (23503→400/404, 23505→409, 23514→409, 22P02→400); istemciye yalnızca sabit kodlar. `db.ts`'te `try { await client.query("ROLLBACK") } catch (e) { client.release(e); throw error }`. `pino` ile JSON log + `x-request-id`.

#### O10 — Migration çalıştırıcı ve ilk yönetici oluşturma yok

- **Konum:** repo geneli
- **Sorun:** `001_initial.sql` elle uygulanmak zorunda; hangi migration'ın uygulandığını izleyen tablo yok; geri alma/ileri sarma prosedürü yok. Sistem yöneticisi kullanıcısını oluşturan bir CLI/seed yok — sistem kurulduğunda kimse giriş yapamaz.
- **Çözüm:** `node-pg-migrate` veya basit bir `schema_migrations` tabanlı çalıştırıcı (`npm run db:migrate`); `npm run admin:create -- --email ...` (parolayı stdin'den alır, loglamaz). Şartname §5 "sürüm kontrollü kurulum".

#### O11 — HTTP katmanı sertleştirmesi

- **Konum:** `server/app.ts:6-8, 213-217`
- **Sorun (kod okuması):** Güvenlik başlıkları (HSTS, `X-Content-Type-Options`, CSP vb.) yok; CORS politikası tanımsız (UI farklı origin'den bağlanırsa ya çalışmaz ya da gelişigüzel açılır); ters proxy arkasında `trust proxy` ve HTTP→HTTPS yönlendirmesi yok (§7 "Tüm trafik HTTPS"); SIGTERM'de havuzun kapatılması ve sürmekte olan isteklerin bitirilmesi yok; `/health` DB bağlantısını kontrol etmiyor.
- **Çözüm:** `helmet`, yalnızca `https://www.bed4book.com` için CORS, `app.set("trust proxy", 1)`, graceful shutdown, `/health/ready` içinde `SELECT 1`.

### 3.4 Düşük

| ID | Konum | Sorun | Öneri |
|---|---|---|---|
| D1 | repo kökü | `.gitignore` yok; `npm install` sonrası `node_modules/` ve `dist-server/` izlenmeyen dosya olarak görünüyor, yanlışlıkla commit riski | `.gitignore`: `node_modules/`, `dist-server/`, `.env*`; `package-lock.json` ise commit edilmeli (Y6) |
| D2 | `001_initial.sql` | `bookings(hotel_id)`, `agency_hotel_sales(agency_id)`, `booking_status_history(booking_id)` indeksleri yok; `updated_at` tetikleyicisi yok; kuyruk `LIMIT 500` sayfalama/filtre yok | İndeksler, `updated_at` tetikleyicisi, imleç tabanlı sayfalama ve durum/tarih filtreleri |
| D3 | `server/security.ts:7` | scrypt varsayılan parametreleri (N=16384); parametreler hash içinde saklanmıyor, ileride yükseltmek zor | `scrypt$N$r$p$salt$hash` formatı ve N=2^17 (OWASP), veya argon2id; parola politikası yalnızca uzunluk |
| D4 | `server/app.ts:18` | `Bearer ` öneki olmayan değer de token olarak deneniyor | Önek zorunlu olsun |
| D5 | `server/app.ts:150` | `UPDATE` sonucu `rowCount` kontrol edilmiyor (kilit sayesinde şu an güvenli, ama savunmacı değil) | K1 çözümündeki gibi `rowCount !== 1` → 409 |
| D6 | `server/app.ts:153` | Para hesabı JS `Number` (kayan nokta) ile yapılıyor | Hesabı SQL `numeric` ile yapın veya kuruş cinsinden tam sayı |
| D7 | `server/app.ts:85-95` | `amenities`, `images`, `category` doğrulanmıyor; görseller serbest URL — §5 erişim kontrollü depolama ile uyumsuz | Şema doğrulama; görseller için yükleme uç noktası + nesne depolama anahtarı |
| D8 | `README.md` | Ana README hâlâ "book4me ai" adını kullanıyor; şartname §1 yeni dokümanlarda yalnızca BED4BOOK'u şart koşuyor | v1 sunucu için ayrı BED4BOOK README; eski adların temizliği ayrı iş olarak planlanmalı |
| D9 | `server/app.ts:59` | `expiresIn: 28800` sabit olarak tekrar yazılmış, `security.ts`'teki TTL ile senkron değil | TTL'i tek sabitten dışa aktarın |

---

## 4. Doğru yapılanlar (korunmalı)

Bu PR'daki bazı kararlar sağlam ve sonraki geliştirmelerde korunmalı:

- **SQL enjeksiyonu yok:** Tüm sorgular parametreli. `${where}` yalnızca sabit metinden oluşuyor.
- **Kiracı bağlamı token'dan türetiliyor**, istek gövdesinden değil (`agencyId`, `ownerAgencyId` master için).
- **Her istekte oturum DB ile yeniden doğrulanıyor** (aktiflik, rol ve acente değişikliği anında etkili).
- **Parola:** tuzlu scrypt, `timingSafeEqual` ile karşılaştırma; minimum 12 karakter.
- **Token:** HMAC-SHA256, sabit zamanlı imza kontrolü, süre ve rol beyaz listesi doğrulaması.
- **Eşzamanlılık:** Envanter satırları tarih sırasıyla `FOR UPDATE` kilitleniyor (deadlock'a karşı tutarlı sıra) ve DB'de `CHECK (reserved <= allotment)` güvenlik ağı var. **P7: kontenjan 5, 20 paralel istek → tam 5 başarılı, 15 × 409, overbooking yok.** (K1 düzeltmesi sonrası.)
- **İzolasyon (mevcut uç noktalarda):** P3 — alt acente B, yalnızca A'ya açılmış fiyat planına rezervasyon yapamıyor (404). P3b — başka ana acente kuyruğunda 0 kayıt görüyor.
- Durum değişikliği, durum geçmişi ve audit **aynı transaction** içinde yazılıyor.
- Üretim sırları ortam değişkeninden okunuyor; sunucu `SESSION_SECRET < 32` ise başlamıyor.
- Uygulama planı eksikleri dürüstçe listeliyor ve "production'a hazır değil" uyarısı veriyor.

---

## 5. Şartname uyum matrisi

### 5.1 Teknik Şartname §8 — Kabul kriterleri

| # | Kriter | Durum | Engelleyen bulgular |
|---|---|---|---|
| 1 | Yönetici otel/oda/fiyat/kontenjan ekler; seçtiği alt acente oteli ve doğru fiyatı görür | ❌ Karşılanmıyor | K4 (uç noktalar yok, otel aktif edilemiyor), K3 (fiyat yanlış), Y3, Y4 |
| 2 | Alt acente rezervasyon oluşturur → Back Office → onay → voucher | ❌ Karşılanmıyor | K1 (rezervasyon 500), K4 (voucher yok), O6 |
| 3 | İki alt acente arasında fiyat/müşteri/rezervasyon tam izolasyonu | ⚠️ Kısmen — mevcut 3 uç noktada doğru; kendi rezervasyonları, detay, voucher ve yayın uç noktaları olmadığından kanıtlanamaz | K4, Y3, Y5, O5, Y6 |
| 4 | Eş zamanlı taleplerde kontenjan tutarsızlığı ve mükerrer rezervasyon engellenir | ⚠️ Kısmen — kilitleme doğru (P7), ancak iade yok (K2) ve idempotency yarışı 500 (O2) | K1, K2, O2, O3 |
| 5 | Yedek geri yükleme, yetkisiz erişim, hata kayıtları, performans testleri | ❌ Karşılanmıyor | Y6, Y7, O9, O10, altyapı (plan kapsamında) |

### 5.2 Proje Şartnamesi §4 — Modüller

| Modül | Durum |
|---|---|
| Genel web alanı | Bu PR kapsamında değil (UI bağlanmadı) |
| Yönetim paneli (API) | ❌ Yalnızca acente ve otel oluşturma var |
| Alt acente paneli (API) | ⚠️ Liste var (eksik filtrelerle), rezervasyon bozuk, takip yok |
| Back Office (API) | ⚠️ Kuyruk ve `pending`'den tek geçiş; detay, geçmiş, not, onay sonrası iptal yok |
| Voucher | ❌ Yok |
| Kullanıcı ve güvenlik | ⚠️ Giriş, roller, parola güvenliği var; kullanıcı yönetimi, rate limit, tam audit yok |

### 5.3 Teknik Şartname §7 — Güvenlik

| Gereksinim | Durum |
|---|---|
| Güçlü, tuzlu parola özeti | ✅ (D3 iyileştirmesi önerilir) |
| HTTPS | ❌ Altyapı + O11 |
| Rol ve acente bazlı erişim backend'de | ⚠️ Mevcut uç noktalarda var; Y2, Y5 boşlukları |
| Hassas işlemler audit'te | ⚠️ Kısmen — O7, Y7 |
| Günlük yedek + geri yükleme testi | ❌ Altyapı (plan kapsamında) |
| Sırlar ortam değişkeninde | ✅ |

---

## 6. Önerilen yol haritası (öncelik sırasıyla)

Her adım, kendi entegrasyon testleri gerçek PostgreSQL ile CI'de yeşil olmadan kapanmamalı (§8).

1. **Test altyapısı önce (Y6):** lockfile + `npm ci`, CI'de Postgres 16 servisi, migration uygulama, entegrasyon test çatısı. K1 için ilk kırmızı test.
2. **K1 düzeltmesi** (tek satır) + D5.
3. **Veri modeli kararları (iş sahibi onayı gerekir):** fiyatlandırma modeli (K3 – A veya B), durum makinesi ve iptal politikası (Y1), Back Office kapsamı (Y5 notu), misafir verisi kapsamı (O6). Ardından `002_*.sql` migration: `booking_nights`, `draft` durumu, rol/acente tipi kısıtları, e-posta lower-unique, yayın tutarlılığı, audit genişletme, indeksler.
4. **K2 + Y1:** iade ve geçiş matrisi, testleriyle.
5. **Y2, Y4, O1, O2, O9:** doğrulama ve sertleştirme.
6. **K4 yönetim uç noktaları:** kullanıcı, otel durumu, oda, fiyat planı, toplu tarih aralığı fiyat/kontenjan, yayınlama; tümü sahiplik kontrolüyle.
7. **K4 acente ve Back Office uç noktaları:** arama, kendi rezervasyonları, detay, geçmiş, notlar.
8. **Voucher (K4).**
9. **Y7, O7, O8, O10, O11** ve altyapı (HTTPS, yedek/geri yükleme tatbikatı, SMTP, nesne depolama, izleme).
10. Uçtan uca kabul senaryoları 1–5'in otomatik testleri ve bağımsız tekrar incelemesi.

---

## 7. Ek — Entegrasyon denemelerinin ham sonuçları

Ortam: PostgreSQL 16, Node.js 22.23, `001_initial.sql` temiz uygulanmış veri tabanı. "Orijinal" = PR HEAD `9d2f73a`; "K1 düzeltilmiş" = yalnızca `server/app.ts:150` parametre listesi düzeltilmiş geçici kopya.

```
=== ORİJİNAL ===
CONFIRMED | P1 booking creation (happy path) | {"status":500,"body":{"error":"INTERNAL_SERVER_ERROR"}}
  (sunucu logu: error: could not determine data type of parameter $2, code 42P18)

=== K1 DÜZELTİLMİŞ KOPYA ===
CONFIRMED | schema accepts role/agency-type mismatch (master_agency user under a sub agency) | login ok
ok        | P1 booking creation (happy path) | 201
CONFIRMED | P2 price ignores inventory_daily.price (100+200) and rate plan currency EUR | total 100 TRY
correct   | P3 isolation: sub B cannot book rate plan published only to A | 404 PRODUCT_NOT_PUBLISHED
correct   | P3b isolation: other master agency sees no bookings | 0
CONFIRMED | P4a non-UUID ratePlanId returns 500 | 500
CONFIRMED | P4b impossible date 2027-13-01 returns non-400 | 500
correct   | P4c 2027-02-30 / 2027-03-02 | 400 INVALID_STAY_DATES (V8 rollover → 0 nights)
CONFIRMED | P4d PATCH with non-UUID id returns 500 | 500
CONFIRMED | P4e past check-in date not rejected by validation | 409 ALLOTMENT_UNAVAILABLE
CONFIRMED | P5 rejection does not release reserved allotment | before 2, after 2
CONFIRMED | P6 approved booking cannot be cancelled | 409 INVALID_STATUS_TRANSITION
CONFIRMED | P6b allotment exhausted by rejected booking -> new booking refused | 409
correct   | P7 20 parallel bookings, allotment 5 | ok=5, conflict=15, max reserved=5
correct   | P7b no booking_no collision in this run | 0
CONFIRMED | P8 concurrent same Idempotency-Key -> 500s instead of replay | 500,500,500,500,201
correct   | P8b only one booking persisted | 1
CONFIRMED | P8c same key + different payload replays old response | 201 (rooms:1 response)
CONFIRMED | P9 users of a deactivated agency can still log in and book | login 200, book 201
CONFIRMED | P10 inactive rate plan + inactive room still bookable | 201
CONFIRMED | P11 publication hotel_id != rate plan hotel accepted; listing shows decoy | ["Decoy Hotel"]
CONFIRMED | P11b listing shows hotel with zero inventory rows | 1
CONFIRMED | P12 case-variant duplicate e-mail accepted | accepted
CONFIRMED | P13 malformed JSON leaks parser message | 400 "Expected property name ... position 1"
CONFIRMED | P14 system_admin hotel with non-existent ownerAgencyId -> 500 | 500
CONFIRMED | P14b hotel can be owned by a SUB agency | 201
CONFIRMED | P15 audit row for rejection carries actor's agency, no before/after/IP | agency_id = master
CONFIRMED | P16 no RLS policies exist although app.agency_id is set | 0
CONFIRMED | P17 GET /api/agency/bookings missing | 404
CONFIRMED | P18 no upper bound on rooms (409 only because of allotment) | 409
```

---

*Bu rapor bağımsız bir teknik incelemedir; önceki geliştirici (insan veya yapay zekâ) çıktıları doğru kabul edilmeden yeniden doğrulanmıştır. Üretim kodunda değişiklik yapılmamıştır. Önerilen düzeltmelerin uygulanması proje sahibinin onayına bağlıdır.*
