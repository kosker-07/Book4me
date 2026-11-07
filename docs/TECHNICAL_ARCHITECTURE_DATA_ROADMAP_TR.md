# Book4me / BED4BOOK — Veri Altyapısı, Hedef Mimari ve Kurulum Yol Haritası

- Belge: Teknik Mimari ve Veri Yol Haritası
- Sürüm: 1.0
- Tarih: 07.11.2026
- Depo: `kosker-07/Book4me`
- İnceleme tabanı: `main` dalındaki mevcut kaynaklar ve `docs/` altındaki teknik şartnameler; bu belge yeni bir hedef mimari önerisidir.
- Durum: Tasarım önerisi — henüz üretim ortamına kurulmuş veya canlı entegrasyonla doğrulanmış değildir.

## 1. Yönetici özeti

Book4me bugün tek HTML dosyasına derlenen, tarayıcı içinde çalışan ve veriyi istemci tarafındaki depolama adaptörü üzerinden yöneten bir B2B rezervasyon prototipidir. Kaynak kodunda domain modülleri, rol/tenant kavramları, fiyatlandırma, arama, rezervasyon, muhasebe, entegrasyon ve testler vardır. Ancak mevcut depolama katmanı üretim amaçlı merkezi bir veritabanı değildir; sunucu adaptörü hedefi tarif edilse de çalışan backend, kalıcı merkezi DB, gerçek tedarikçi adaptörleri ve sunucu tarafında yetkilendirme bu incelemede doğrulanmamıştır.

**Önerilen yön:** Mevcut iş kurallarını koruyarak, kademeli biçimde istemci ağırlıklı prototipten sunucu kontrollü, çok kiracılı bir B2B platforma geçmek. İlk aşamada mikroservis karmaşıklığı yerine modüler monolit backend; ilişkisel ana veri için PostgreSQL; kuyruk ve geçici cache için Redis; dosyalar için nesne depolama; otomatik test ve dağıtım için GitHub Actions kullanılması önerilir.

Bu belge teknoloji seçimini, veri modelini, kurulum sırasını, geçiş risklerini ve Claude tarafından yapılacak bağımsız inceleme kriterlerini tanımlar. Buradaki hedef mimari, mevcut kodda tamamlanmış özellik olarak yorumlanmamalıdır.

## 2. Değişmez ürün kuralları

Bu kurallar tasarım, API, veritabanı, kullanıcı arayüzü ve testlerde aynı şekilde uygulanmalıdır.

1. **Rezervasyon tutma/kilitleme yok:** Arama sırasında booking kaydı, geçici rezervasyon, oda/stock/allotment kilidi veya süreli envanter tutma oluşturulmaz. Arama cevabı yalnızca zaman damgalı fiyat ve müsaitlik gözlemidir.
2. **Tek kazanan fiyat:** Karşılaştırılabilir ve tüm uygunluk kontrollerini geçen teklifler arasında normalize edilmiş toplam fiyatı en düşük olan yalnızca bir teklif seçilir.
3. **Alternatif teklif gösterilmez:** Kazanan dışındaki teklifler son kullanıcıya alternatif, ikinci seçenek veya otomatik fallback olarak sunulmaz. İç denetim için sınırlı süreli teknik iz tutulması ayrıca tasarlanabilir; bu kayıtlar UI/API yanıtına sızamaz.
4. **Yalnız kazananı yeniden doğrula:** Kullanıcı rezervasyon talebi verdiğinde yalnızca kazanan teklifin tedarikçisinden fiyat ve müsaitlik tekrar doğrulanır.
5. **Otomatik ikinci sıraya geçiş yok:** Kazanan recheck başarısızsa rezervasyon isteği başarısız sonuçlanır ve yeni arama istenir. İkinci teklif sessizce devreye alınmaz.
6. **Tedarikçi onayı olmadan kesinleşme yok:** Rezervasyon ancak tedarikçiden başarılı kesin rezervasyon yanıtı ve tedarikçi referansı alındığında onaylı sayılır.
7. **İş akışları ayrıdır:** Search/booking, Rebooking ve RateRelay ayrı domain süreçleridir. Ortak kimlik, tenant, rezervasyon referansı, audit ve entegrasyon altyapısını paylaşabilirler; karar kuralları birbirine karıştırılmaz.

## 3. GitHub incelemesinden çıkan mevcut durum

İncelenen ana depo: `kosker-07/Book4me`, varsayılan dal: `main`. `book4meai` adlı ikinci depo da mevcut ancak arama sonucunda boyutu 0 görünmektedir; aktif kaynak kodu olarak `Book4me` esas alınmıştır.

### 3.1 Doğrulanabilen mevcut yapı

- `README.md`: v41 çevrimdışı tarayıcı modeli; tek HTML çıktısı; domain, UI, reader, tools ve tests dizinleri.
- `tools/build.js`: kaynak JS modüllerini tek `dist/index.html` içine birleştiriyor.
- `src/core/store.js`: LocalAdapter/MemoryAdapter tabanlı veri katmanı ve tenant scope yaklaşımı mevcut. Sunucu adaptörü geçiş hedefi olarak anlatılıyor; üretim backend'i olarak doğrulanmadı.
- `src/core/app.js`: uygulama bağlamı, olay üretimi ve audit log işlevleri mevcut.
- `src/domain/search.js`: otel/transfer/tur araması, pazar-milliyet uygunluğu, oda kapasitesi ve fiyat sıralaması gibi istemci tarafı iş mantığı mevcut.
- `src/domain/booking.js`: rezervasyon, ödeme, iptal, ledger ve bildirim mantığı mevcut.
- `src/updates/u008-bed4book-core.js`: Rebooking v2 ve RateRelay için adapter-driven iş akışları eklenmiş. Kod gerçek tedarikçi bağlantısı olduğunu kanıtlamaz.
- `tests/`: birim ve UI akış testleri mevcut; bunların varlığı canlı tedarikçi entegrasyonunu veya üretim güvenliğini tek başına kanıtlamaz.

### 3.2 Kritik boşluklar / doğrulanması gereken çelişkiler

| Alan | Mevcut kanıt | Teknik sonuç |
|---|---|---|
| Merkezi veritabanı | Store katmanı tarayıcı LocalAdapter/MemoryAdapter odaklı | Çok kullanıcılı gerçek zamanlı çalışma için PostgreSQL ve backend gerekir |
| Backend/API | Derleme ve istemci domain kodu var; üretim API servisi doğrulanmadı | Tüm kritik kararlar sunucuya taşınmalı |
| Tenant güvenliği | Store scope istemci tarafında filtreleme sağlıyor | Güvenlik sınırı değildir; sunucuda her sorguda tenant + rol + nesne yetkisi zorunlu |
| Arama | `SR.offersFor`, `SR.alloc`, `SR.hotels` fiyat ve müsaitlik hesaplıyor | Yeni şartnamedeki tam teklif normalizasyonu ve tek kazanan sözleşmesiyle karşılaştırılmalı |
| Rezervasyon | `BK.place` yerel DB'ye rezervasyon ekleyip durumu doğrudan “Onaylı” yapabiliyor | Gerçek tedarikçi recheck/confirm olmadan onay verilmemeli; akış yeniden tasarlanmalı |
| Stok | Arama kodunda mevcut rezervasyonlardan allotment/availability hesaplanıyor | Arama sırasında bu hesap bir kilit oluşturmamalı; kaynak tedarikçi müsaitliği ayrı ve güncel doğrulanmalı |
| Rebooking / RateRelay | u008 adapter-driven; eski u002e akışı README ve Claude handoff'ta çelişkili olarak işaretlenmiş | Eski ve yeni akışlar aynı rezervasyonda birlikte çalıştırılmamalı; cutover planı şart |
| Kalıcı iş kuyruğu | u008 içindeki inFlight Map süreç belleğinde; tarayıcı store semantiğine dayanıyor | Dağıtık idempotency, job retry ve restart recovery için DB constraint + Redis queue/outbox gerekir |
| Kimlik bilgileri | Demo/seed verileri ve istemciye dönük kod örnekleri mevcut | Gerçek API anahtarları istemciye veya Git'e konmamalı; secret manager kullanılmalı |

**Önemli:** `BK.place` içindeki “Onaylı” ataması ve gerçek tedarikçi onayına dayanmayan rezervasyon oluşturma davranışı, hedef şartnameyle uyumlu kabul edilmemelidir. Bu birinci öncelikli mimari düzeltmedir. Mevcut demo akışları bozulmadan önce gerçek booking state machine ve testleri tasarlanmalıdır.

## 4. Hedef teknoloji mimarisi

### 4.1 Önerilen teknoloji kararları

| Katman | Öneri | Neden / sınır |
|---|---|---|
| Web istemcisi | İlk geçişte mevcut arayüzü koru; yeni ekranlarda TypeScript + React + Vite | Büyük çaplı yeniden yazım riskini azaltır; modül modül dönüşüm sağlar |
| Backend | Node.js LTS + TypeScript + NestJS (modüler monolit) | Mevcut JS ekosistemiyle uyum; modül sınırları, DTO/validation, guard ve test yapısı |
| API | REST + OpenAPI 3.1; webhook için imza doğrulama | B2B entegrasyonları için anlaşılır, sürümlenebilir sözleşme |
| Ana veritabanı | PostgreSQL 18 (yönetilen hizmet) | İlişkisel ticari veri, transaction, unique constraint, JSONB ve raporlama |
| ORM/migration | Prisma + sürümlü SQL migration; kritik constraint/index için SQL | Tip güvenliği ve tekrar üretilebilir şema; DB yetenekleri ORM'e feda edilmez |
| Cache / kuyruk | Redis + BullMQ | Cache, rate limit, supplier fan-out işleri ve zamanlanmış işler; kalıcı kayıt sistemi değildir |
| Dosya | S3 uyumlu nesne depolama veya Supabase Storage | Excel, PDF, voucher ve görseller; DB'ye dosya binary'si koymama |
| Kimlik | Sunucu tarafında doğrulanan OIDC/JWT; MFA destekli yönetici erişimi | İstemci state'i yetki kanıtı değildir |
| Gözlemlenebilirlik | OpenTelemetry + merkezi log/metric/error izleme | Search, supplier, booking ve ödeme adımlarını correlation ID ile izleme |
| Dağıtım | Docker; GitHub Actions CI/CD; staging ve production ayrımı | Tekrarlanabilir build, test, migration ve kontrollü release |
| Güvenlik | OWASP ASVS 5.0.0 tabanlı kontrol listesi | API, oturum, erişim, input validation, log ve CI/CD güvenliği |

**Karar notu:** İlk canlı sürümde mikroservislere bölünmeyin. Tek deploy edilebilir backend içinde `identity`, `tenants`, `catalog`, `supplier-integrations`, `search`, `pricing`, `booking`, `accounting`, `rebooking`, `rate-relay`, `notifications` modüllerini ayırın. Trafik, ekip sahipliği veya bağımsız ölçek ihtiyacı kanıtlandığında servis ayrıştırması yapın.

### 4.2 Veritabanı barındırma kararı

İlk tercih: yönetilen PostgreSQL (Supabase Postgres veya eşdeğer yönetilen PostgreSQL). Supabase seçilirse Auth/Storage/branching gibi kabiliyetler değerlendirilebilir; ancak kritik ticari iş kuralları ve yetki kontrolleri yalnızca istemciye veya RLS varsayımına bırakılmamalıdır. Backend servisinin kimliği ve tenant kapsamı sunucuda doğrulanmalıdır.

Alternatif: Google Cloud SQL for PostgreSQL veya başka bir yönetilen PostgreSQL hizmeti. Sağlayıcı seçimi; veri yerleşimi, KVKK/GDPR, SLA, yedekleme, PITR, bağlantı havuzu, maliyet ve ekip işletim kapasitesiyle kararlaştırılmalıdır. Henüz sağlayıcı hesabı, bölge veya bütçe doğrulanmadığından kesin bulut sağlayıcısı seçilmiş sayılmaz.

## 5. Mantıksal veri modeli

Aşağıdaki tablo listesi hedef tasarımdır; mevcut veritabanında var oldukları anlamına gelmez. Her tabloda birincil anahtar UUID (veya uygun bigint), `created_at`, `updated_at`, gerekli tablolarda `tenant_id` ve optimistic concurrency için `version` alanı düşünülmelidir.

### 5.1 Kimlik ve çok kiracılık

- `tenants`: platform, DMC ve alıcı organizasyon kökleri; durum, plan ve temel ticari ayarlar.
- `users`: kullanıcı kimliği, tenant üyeliği, e-posta, durum.
- `roles`, `permissions`, `role_permissions`, `user_roles`: rol ve yetki matrisi.
- `api_clients`, `api_credentials_ref`: API istemcileri ve secret manager referansları; gizli anahtar değeri DB'de düz metin tutulmaz.
- `tenant_domains`, `tenant_settings`: marka, alan adı ve tenant yapılandırması.

### 5.2 Tedarik ve katalog

- `suppliers`: tedarikçi/DMC ana kaydı.
- `supplier_connections`: endpoint, protokol, aktiflik, timeout ve credential referansı.
- `properties`: canonical otel/tesis.
- `property_aliases`: tedarikçi tesis kodu → canonical property eşlemesi.
- `room_types`, `supplier_room_mappings`: ortak oda tanımı ve tedarikçi oda kodu eşlemesi.
- `board_types`, `amenities`, `property_content`: board ve tesis içeriği.
- `contracts`, `contract_seasons`, `market_rules`: sözleşme, sezon, milliyet/pazar ve satış uygunluğu.
- `supplier_sync_runs`: katalog/içerik senkronizasyon geçmişi ve hataları.

### 5.3 Arama ve fiyat

- `search_sessions`: tenant, arama parametreleri, correlation ID, durum, başlama/bitiş zamanı.
- `supplier_search_calls`: her tedarikçi çağrısı, timeout, latency, sonuç sayısı, hata kodu.
- `supplier_offers`: iç sistemde kısa TTL ile tutulan ham/normalize teklif; son kullanıcıya alternatif liste olarak açılmaz.
- `offer_price_components`: baz tutar, vergi, zorunlu ücret, komisyon/markup ve para birimi bileşenleri.
- `fx_rates`: kur kaynağı, kur zamanı, baz/hedef para birimi ve değer.
- `winner_quotes`: seçilen tek kazananın referansı, eşdeğerlik anahtarı, normalize toplamı, gösterim toplamı, kur ve quote timestamp.
- `search_audit_events`: uygunluk dışı kalma nedenleri ve kazanan kararının izlenebilir özeti.

Teklifler kısa süreli saklanacaksa TTL/partition/temizlik politikası tanımlanmalı. Tedarikçi sözleşmeleri veya gizlilik gereği ham teklif saklanamıyorsa yalnızca karar için gereken asgari audit alanları tutulmalıdır.

### 5.4 Rezervasyon ve finans

- `booking_requests`: kullanıcı rezervasyon talebi; idempotency key ve durum.
- `booking_rechecks`: yalnızca kazanan teklifin yeniden doğrulama isteği/yanıtı.
- `bookings`: kesinleşmiş tedarikçi rezervasyonu; tedarikçi referansı ve onay zamanı zorunlu.
- `booking_events`: durum geçişleri için append-only event geçmişi.
- `booking_guests`: misafir/occupancy verisi; kişisel veri erişimi kısıtlı.
- `cancellation_policies`, `payment_terms`: sözleşme koşullarının snapshot'ı.
- `payment_transactions`, `refunds`: ödeme sağlayıcı işlem referansları; kart verisi sistemde tutulmaz.
- `ledger_accounts`, `ledger_entries`, `invoices`, `commissions`: muhasebe alt defteri ve ticari kayıtlar.
- `idempotency_records`: tenant + endpoint + key için unique kayıt ve sonuç özeti.
- `outbox_events`: transaction ile aynı DB commit'inde yazılan dış sistem olayları.

### 5.5 Operasyon, audit ve entegrasyon

- `audit_events`: actor, tenant, action, resource, timestamp, correlation ID; append-only.
- `supplier_webhook_events`: imza doğrulaması, tekrar işleme koruması ve ham payload erişim kısıtı.
- `background_jobs`: gerekiyorsa DB'de iş durumu; Redis queue iş dağıtımı yapar.
- `integration_health`: tedarikçi erişilebilirliği, hata oranı, son başarılı çağrı.
- `documents`: nesne depolamadaki dosya anahtarı, checksum, tür ve erişim politikası.

### 5.6 Temel veri kuralları ve indeksler

- Tüm zamanlar UTC saklanır; tedarikçi yerel timezone ve iptal deadline ayrıca korunur.
- Para tutarları kayan nokta yerine `NUMERIC(19,4)` gibi decimal türle; para birimi ISO 4217 koduyla tutulur.
- Arama karşılaştırması yalnızca eşdeğerlik şartları aynı olan tekliflerde yapılır.
- `winner_quotes` üzerinde search + equivalence key başına tek kazanan kısıtı.
- `idempotency_records` üzerinde tenant + operation + key unique kısıtı.
- Tenant verilerinde tenant_id içeren bileşik indeksler ve foreign key kontrolleri.
- Booking reference için supplier + supplier reference unique kısıtı.
- Audit/event tablolarında zaman ve tenant bazlı indeks/partition stratejisi.
- Misafir kişisel verisi şifreleme, erişim logu ve saklama süresi politikasıyla korunur.

## 6. Kritik iş akışları

### 6.1 Search → Winner

1. API tenant, kullanıcı ve arama parametrelerini doğrular.
2. Query planner, ilgili pazara/ürüne uygun tedarikçileri seçer.
3. Tedarikçi adaptörleri timeout ve concurrency sınırlarıyla paralel çağrılır.
4. Gelen tekliflerin tesis/oda/board/occupancy/tarih/iptal/ödeme/pazar eşdeğerliği doğrulanır.
5. Vergi, zorunlu ücret, komisyon/markup ve FX ile karşılaştırılabilir toplam fiyat hesaplanır.
6. Uygun teklifler arasında tek en düşük fiyatlı kazanan belirlenir.
7. API yalnızca kazananı ve açıklanabilir fiyat bileşenlerini döndürür; alternatif teklifler kullanıcıya dönmez.
8. Search kaydı ve karar audit'i yazılır. Hiçbir hold/lock/booking oluşturulmaz.

### 6.2 Winner → Booking

1. İstemci yalnızca kazanan quote ID ile rezervasyon talebi gönderir.
2. Backend idempotency key'i kaydeder ve quote'un tenant/expiry bağlamını doğrular.
3. Sadece kazanan tedarikçide recheck yapılır.
4. Recheck fiyat/koşul/müsaitlik değiştiyse veya başarısızsa işlem durur; ikinci teklif denenmez.
5. Recheck uygunsa tedarikçiye kesin rezervasyon create çağrısı gönderilir.
6. Tedarikçi onayı ve referansı gelmeden booking `CONFIRMED` olmaz.
7. Başarılı sonuç, DB transaction içinde booking + event + outbox + audit olarak yazılır.
8. Belirsiz timeout durumunda tekrar create çağrısı yapmadan önce tedarikçi idempotency/reference sorgusu veya reconciliation uygulanır.

Önerilen booking state machine: `REQUESTED → RECHECKING → READY_TO_BOOK → SUPPLIER_PENDING → CONFIRMED`; hata yolları `RECHECK_FAILED`, `PRICE_CHANGED`, `SUPPLIER_REJECTED`, `UNKNOWN_OUTCOME_RECONCILIATION`. Hold/held/locked gibi durumlar bu state machine'de bulunmaz.

## 7. API taslağı

API sürümlü olmalı: `/api/v1`.

- `POST /searches`: arama oturumu açar, sadece kazanan quote döndürür.
- `GET /searches/{id}`: arama durumu ve kazanan özetini döndürür.
- `GET /quotes/{id}`: tenant kapsamındaki kazanan quote ayrıntısı.
- `POST /booking-requests`: `winnerQuoteId` + `Idempotency-Key` ile rezervasyon talebi.
- `GET /bookings/{id}`: rezervasyon ve tedarikçi onay durumu.
- `POST /supplier-webhooks/{supplierCode}`: imzalı tedarikçi callback'i.
- `GET /health`, `GET /ready`: servis sağlık kontrolleri.

API yanıtında supplier internal ID, rakip fiyatlar, ikinci/üçüncü teklifler veya gizli kontrat verileri açığa çıkmamalıdır. OpenAPI şeması ve contract testleri zorunludur.

## 8. Kurulum ve ortam yapısı

### 8.1 Ortamlar

- Local: Docker Compose ile API + PostgreSQL + Redis + test mail/webhook sink.
- Development: geliştiriciye özel izole DB ve sahte tedarikçi adapterları.
- Staging: production'a benzer altyapı; yalnızca tedarikçi sandbox bilgileri.
- Production: yönetilen PostgreSQL, Redis/queue, secret manager, object storage, TLS, WAF/rate limit, izleme ve yedekleme.

Development, staging ve production veritabanları/anahtarları birbirinden ayrılmalıdır. Production verisi yerel geliştirme ortamına kopyalanmamalıdır.

### 8.2 Repo içinde hedef dizin

```
apps/
  web/                 # React/Vite istemci (kademeli geçiş)
  api/                 # NestJS modüler monolit
packages/
  contracts/           # OpenAPI DTO / shared types
  domain/              # saf iş kuralları; framework bağımsız
  supplier-adapters/   # tedarikçi başına adaptör
infra/
  docker/              # local compose ve container tanımları
  migrations/          # DB migration (Prisma/SQL)
  observability/
docs/
  TECHNICAL_ARCHITECTURE_DATA_ROADMAP_TR.md
  CLAUDE_TECHNICAL_REVIEW_PROMPT_TR.md
.github/workflows/
  ci.yml
  deploy-staging.yml
  deploy-production.yml
```

Bu dizin öneridir; mevcut `src/` yapısı tek seferde silinmemeli. Önce API ve DB katmanı eklenmeli, sonra domain mantığı kontrollü biçimde taşınmalıdır.

### 8.3 İlk kurulum adımları

1. Node.js LTS, TypeScript, package manager ve lockfile standardını belirle.
2. Docker Compose ile PostgreSQL 18 ve Redis local servislerini başlat.
3. `apps/api` NestJS projesini kur; health endpoint ve config validation ekle.
4. Prisma şeması ve ilk migration ile tenants/users/roles tablolarını oluştur.
5. Secret manager ve environment variable örneklerini tanımla; gerçek sırları Git'e ekleme.
6. CI'da lint, typecheck, unit, integration, migration validation ve dependency/security scan çalıştır.
7. Staging DB, backup/PITR, TLS, log/metric ve alarm kurulumunu tamamla.
8. Supplier adapter sandbox testleri geçmeden gerçek booking create özelliğini açma.

## 9. Güvenlik ve veri koruma

- Tenant izolasyonu backend'de zorunludur; istemci filtreleri güvenlik mekanizması değildir.
- Her API çağrısında authentication + role/permission + tenant + resource ownership kontrolü.
- DB uygulama kullanıcısı least privilege olmalı; migration/admin hesabı runtime'da kullanılmamalı.
- Secret değerleri secret manager'da; loglarda token, parola, kart verisi ve gereksiz kişisel veri bulunmamalı.
- SQL injection için parametreli sorgular; input validation; output encoding; CSRF/CORS politikası.
- Admin MFA, brute-force/rate limit, session expiry/rotation, secure cookie.
- Webhook HMAC/signature, timestamp ve replay protection.
- TLS in transit, at-rest encryption, yedekleme şifrelemesi, restore testleri.
- Audit kayıtları değiştirilemez/append-only olmalı.
- KVKK/GDPR için veri envanteri, amaç/saklama süresi, silme/anonimleştirme ve veri sahibi talepleri ayrıca hukuk/uyum ekibiyle netleştirilmeli.

Güvenlik kabul listesi OWASP ASVS 5.0.0 ile eşleştirilmeli. CI/CD pipeline da ayrı bir saldırı yüzeyi olarak korunmalıdır.

## 10. Aşamalı uygulama yol haritası

| Faz | İş paketi | Çıktı / geçiş kapısı |
|---|---|---|
| 0 — Audit ve ürün kilidi | Kod/test envanteri; hold/lock izleri; mevcut booking state; teknik şartname çatışmaları | PASS/FAIL raporu ve onaylanmış domain kuralları |
| 1 — Platform temeli | TypeScript API, PostgreSQL, migration, auth, tenant RBAC, audit | İki tenant arasında negatif erişim testleri geçer |
| 2 — Katalog ve tedarikçi | Canonical property/room/board, alias mapping, adapter contract, sandbox | En az bir tedarikçi sandbox'ında katalog ve arama contract testi |
| 3 — Search/Winner | Search orchestration, normalizasyon, uygunluk, tek kazanan, TTL | Eşdeğerlik + en düşük fiyat + no-alternative API testleri |
| 4 — Booking güvenliği | Winner-only recheck, idempotent booking create, confirmation, reconciliation | Recheck fail/price change/timeout/duplicate/confirm senaryoları geçer |
| 5 — Finans ve operasyon | Ledger, ödeme referansları, event outbox, bildirim, jobs | Muhasebe mutabakatı ve retry/restart testleri |
| 6 — UI ve veri geçişi | Mevcut ekranların API'ye bağlanması, veri import ve doğrulama | Kullanıcı kabulü, veri sayım/total reconciliation |
| 7 — Pilot ve canlıya geçiş | Staging soak, güvenlik/perf testi, DMC pilot, rollback planı | Go-live checklist imzalı; canlı tedarikçi onayı kanıtlı |

Öncelik: Faz 0 → Faz 1 → Faz 2 → Faz 3 → Faz 4. Gerçek tedarikçi booking entegrasyonu doğrulanmadan ödeme ve otomatik süreçleri genişletmeyin.

## 11. Test ve kabul matrisi

| Test | Beklenen sonuç |
|---|---|
| Search hold/lock kontrolü | Search sonrası booking/hold/inventory lock kaydı yok |
| Tek kazanan | Eşdeğer teklifler içinde normalize toplamı en düşük tek quote döner |
| Eşdeğer olmayan teklifler | Aynı karşılaştırma havuzuna girmez |
| Alternatif gizliliği | API/UI yalnız kazananı döndürür; diğer teklifler dışarı sızmaz |
| Recheck | Yalnız kazanan tedarikçiye çağrı yapılır |
| Recheck başarısız | İkinci teklif çağrılmaz; kullanıcı yeni arama yapar |
| Booking confirm | Supplier confirmation/reference olmadan CONFIRMED oluşmaz |
| Idempotency | Aynı key ile tekrar istek duplicate booking oluşturmaz |
| Tenant isolation | Tenant A, Tenant B kaydını ID tahminiyle dahi okuyamaz/değiştiremez |
| Supplier timeout | Kısmi sonuç ve hata kapsamı açıklanır; yanlış başarı üretilmez |
| FX/fiyat | Decimal hassasiyet, kur kaynağı/zamanı ve toplam bileşenler deterministik |
| Recovery | Worker restart ve timeout sonrası reconciliation duplicate booking yaratmaz |
| Legacy cutover | Eski Rebooking ve v2 aynı reservation için eşzamanlı çalışmaz |
| Backup restore | Yedekten geri dönüş düzenli tatbikatla kanıtlanır |

## 12. Riskler ve açık kararlar

1. **Tedarikçi API gerçekleri:** Hangi DMC'lerin canlı/sandbox endpoint, availability recheck, booking create, cancel ve idempotency desteklediği tedarikçi bazında doğrulanmalı.
2. **Fiyat semantiği:** Net/gross, vergi, resort fee, komisyon, markup, kur kaynağı ve yuvarlama tek bir iş kuralı olarak onaylanmalı.
3. **Eşdeğerlik:** Oda/yatak/board/iptal/ödeme/pazar eşdeğerliği için yönetilebilir canonical sözlük gerekli.
4. **Rezervasyon onayı:** Bazı tedarikçiler asenkron onay verebilir; PENDING ve reconciliation akışı tasarlanmalı.
5. **Veri göçü:** Demo seed ve localStorage verileri üretim verisi olarak otomatik taşınmamalı; veri temizliği ve mapping yapılmalı.
6. **Rebooking/RateRelay:** u008 adapter modülü ile eski u002e modülünün çakışmaları için cutover ayrı iş paketi olmalı.
7. **Bulut sağlayıcısı:** Bölge, veri yerleşimi, KVKK, SLA, bütçe ve operasyon sorumlusu belirlenmeden sağlayıcı kesinleştirilmemeli.
8. **Yük ve SLA:** Gerçek trafik profili olmadan kapasite veya P95 hedefi taahhüt edilmemeli; staging ölçümüyle belirlenmeli.

## 13. Kaynak ve referanslar

### Depo içi kaynaklar
- `README.md`
- `src/core/store.js`
- `src/core/app.js`
- `src/domain/search.js`
- `src/domain/booking.js`
- `src/updates/u008-bed4book-core.js`
- `tests/u008-bed4book.js`
- `docs/Cloude_Book4me_Arama_Motoru_Teknik_Sartname.md`
- `docs/BED4BOOK_MASTER_TECHNICAL_SPEC.md`
- `docs/CLAUDE_HANDOFF_BED4BOOK.md`

### Harici teknik referanslar
- PostgreSQL: https://www.postgresql.org/docs/
- Supabase deployment ve GitHub workflow: https://supabase.com/docs/guides/deployment
- Docker PostgreSQL kalıcı volume ve Compose rehberi: https://docs.docker.com/guides/postgresql/
- OWASP ASVS 5.0.0: https://asvs.owasp.org/
- OWASP CI/CD Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/CI_CD_Security_Cheat_Sheet.html
- OWASP Database Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Database_Security_Cheat_Sheet.html

---

## 14. Claude incelemesi için talimat

Bu belgenin yanındaki `CLAUDE_TECHNICAL_REVIEW_PROMPT_TR.md` dosyasını kullan. Claude'dan mimariyi yalnızca onaylaması değil, repo kodunu ve testlerini inceleyerek kanıtlı PASS/FAIL, dosya/satır referansı, çelişkiler, eksikler ve düzeltilmiş öneri sunması istenir.
