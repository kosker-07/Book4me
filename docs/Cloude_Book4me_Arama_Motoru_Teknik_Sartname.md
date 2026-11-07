# Cloude / Book4me — Özgün B2B Arama Motoru Teknik Şartnamesi

- **Belge sürümü:** 1.0
- **Tarih:** 07.11.2026
- **Durum:** Ürün kuralları ve hedef mimari için ana referans
- **Depo:** `kosker-07/Book4me`
- **Kapsam:** B2B otel/DMC arzı, arama, teklif normalizasyonu, tek kazanan fiyatın seçilmesi ve rezervasyon devri

> Bu belge, Book4me için hedeflenen davranışı tanımlar. Burada tarif edilen mimari veya entegrasyonlar, mevcut kodda tamamlanmış ya da canlı tedarikçi API'lerine bağlı oldukları anlamına gelmez. Uygulama durumu kod ve testlerle ayrıca doğrulanmalıdır.

## 1. Ürün hedefi

Farklı DMC ve B2B tedarikçilerinden gelen otel arzını ortak bir katalog ve teklif modelinde birleştirmek; arama koşullarına uyan teklifleri karşılaştırmak; eşdeğer ve geçerli teklifler arasından **tek en düşük fiyatlı teklifi** seçmek; rezervasyon isteğinde yalnızca bu teklifi yeniden doğrulayıp doğrudan kesin rezervasyon talebi göndermek.

Platformun uzun vadeli hedefi üç ana kabiliyeti birleştirmektir:

1. **Supply Engine:** DMC/tedarikçi bağlantıları, kontratlar, otel ve oda içerikleri, fiyat ve müsaitlik arzı.
2. **Intelligence Engine:** Ürün eşleştirme, teklif normalizasyonu, uygunluk kontrolleri ve tek kazanan fiyat motoru.
3. **Distribution Engine:** B2B müşteri/DMC kanalları, satış fiyatı, rezervasyon ve rezervasyon sonrası süreçler.

## 2. Değiştirilemez iş kuralları

### 2.1 Rezervasyon tutma veya stok kilitleme yok

- Arama sırasında rezervasyon oluşturulmaz.
- Arama sırasında oda, allotment, kontenjan veya stok kilitlenmez.
- Geçici rezervasyon, booking hold, room hold, inventory lock veya benzeri bir mekanizma kullanılmaz.
- Arama yanıtı fiyat ve müsaitlik anlık görüntüsüdür; rezervasyon garantisi değildir.
- Arama ile rezervasyon isteği arasında fiyat veya müsaitlik değişebilir.

### 2.2 Tek kazanan: eşdeğer geçerli teklifler arasındaki en düşük fiyat

- Önce teklifler aynı ürün ve aynı satış koşullarına göre karşılaştırılabilir hâle getirilir.
- Uygunluk koşullarını geçemeyen teklifler değerlendirme dışıdır.
- Uygun teklifler arasında normalize edilmiş toplam satış maliyeti en düşük olan **tek teklif** seçilir.
- Kazanan dışındaki teklifler kullanıcıya alternatif olarak gösterilmez ve rezervasyon akışına taşınmaz.
- Kazanan seçildikten sonra ikinci sıradaki teklif bir yedek/fallback olarak saklanıp otomatik kullanılmaz.
- Fiyat eşitliğinde deterministik teknik tie-break uygulanır; bu kural fiyatı daha yüksek bir teklifi kazanan yapamaz.

### 2.3 Rezervasyon akışı

1. Arama isteğini al.
2. Tedarikçilerden fiyat ve müsaitlik sorgularını paralel yürüt.
3. Sonuçları ortak ürün/oda/teklif modeline dönüştür.
4. Uygunluk kontrollerini uygula.
5. Tek en düşük fiyatlı kazananı belirle.
6. Kullanıcı rezervasyon istediğinde yalnızca kazanan tedarikçide fiyat ve müsaitliği yeniden doğrula.
7. Yeniden doğrulama başarısızsa otomatik olarak ikinci teklife geçme; işlem başarısız dönsün ve yeni arama yapılmasını iste.
8. Yeniden doğrulama başarılıysa doğrudan kesin rezervasyon talebi gönder.
9. Rezervasyon ancak tedarikçinin kesin onayıyla oluşturulmuş kabul edilir; tedarikçi onay numarası ve yanıtı kaydedilir.

## 3. Arama isteği ve arama deneyimi

### 3.1 Lokasyon arama

Arama motoru aşağıdaki lokasyon türlerini destekleyecek şekilde tasarlanmalıdır:

- Ülke, şehir, bölge/ilçe ve turistik destinasyon
- Otel/tesis adı ve tesis kimliği
- Havalimanı ve ulaşım noktaları
- Landmark/önemli nokta
- Koordinat, harita alanı ve mesafe bazlı arama

Beklenen UX kabiliyetleri: autocomplete, yazım hatası toleransı, eş anlamlı ve transliterasyon desteği, çok dilli arama, popüler ve son aramalar, lokasyon türünü açıkça belirtme.

### 3.2 Tarih ve konaklama

- Giriş/çıkış tarihi ve gece sayısı
- Esnek tarih araması (tedarikçi kabiliyetleri uygunsa)
- Birden fazla oda
- Her oda için yetişkin sayısı
- Çocuk sayısı ve çocuk yaşları
- Pazar/milliyet ve para birimi
- İstek doğrulama: çıkış girişten sonra olmalı; oda ve yolcu sayıları geçerli olmalı.

### 3.3 Filtre taksonomisi

Filtreler yalnızca gerçek ve doğrulanmış içerik/teklif verisi varsa gösterilmelidir:

- Toplam fiyat aralığı
- Yıldız ve misafir puanı
- Tesis türü ve marka/zincir
- Konaklama/board türü
- Ücretsiz iptal ve iptal son tarihi
- Ödeme zamanı ve ödeme koşulları
- Kredi kartı/ön ödeme gereksinimi
- Wi-Fi, havuz, plaj, spa, otopark, aile, erişilebilirlik, evcil hayvan ve benzeri olanaklar
- Merkeze, havalimanına veya seçilen noktaya mesafe
- Harita alanı

Filtre sonucu, tedarikçi verisinin eksik olduğu durumlarda yanlış kesinlik üretmemelidir. Bilinmeyen özellik, varmış veya yokmuş gibi değerlendirilmemelidir.

### 3.4 Sonuç kartı ve tesis/oda detayı

Sonuç kartında en azından tesis adı, lokasyon, görsel/içerik, yıldız/puan (veri varsa), konaklama tarihleri, kişi/oda özeti, oda ve board özeti, iptal koşulu, vergiler dâhil toplam fiyat ve fiyatın para birimi bulunmalıdır.

Tesis detayında oda bazlı içerik, yatak/kapasite, board, iptal ve ödeme politikaları, vergi/ücret açıklaması ve içerik kaynağının güncelliği gösterilmelidir.

## 4. Tek kazanan fiyat motoru

### 4.1 Ön eşleştirme ve uygunluk

Fiyat sıralamasından önce aşağıdaki alanlar eşdeğer olmalıdır:

- Aynı tesis (canonical property)
- Aynı veya eşdeğer oda tipi ve yatak düzeni
- Aynı kişi/oda kapasitesi ve çocuk yaşları
- Aynı board/meal plan
- Aynı konaklama tarihleri
- Aynı iptal ve iade koşulları
- Aynı ödeme koşulları
- Vergi, zorunlu ücret ve ek masrafların toplam fiyata dahil edilme durumu
- Milliyet/pazar satış uygunluğu
- Teklifin geçerli müsaitliği ve tazeliği

Eşdeğer olmayan teklifler aynı fiyat havuzunda karşılaştırılmamalıdır.

### 4.2 Fiyat normalizasyonu

- Tedarikçi para birimi ortak karşılaştırma para birimine dönüştürülür.
- Döviz kuru kaynağı ve zaman damgası kaydedilir.
- Konaklama toplamı, zorunlu vergi ve ücretler, komisyon/markup ve uygulanabilir satış masrafları tek bir toplam maliyet hesabında ele alınır.
- Yuvarlama ve kur hassasiyeti deterministik olmalıdır.
- Kazanan seçiminde kullanılan fiyat ile kullanıcıya gösterilen satış fiyatı izlenebilir olmalıdır.

### 4.3 Seçim

Uygunluk kontrollerini geçen teklifler normalize edilmiş toplam fiyatlarına göre artan sırada değerlendirilir ve yalnızca ilk teklif kazanan olarak döndürülür. Kazanan dışında kalan teklifler UI, satış kararı veya rezervasyon devrine gönderilmez.

## 5. Hedef teknik mimari

Önerilen bileşenler:

- **Search Gateway:** İstek doğrulama, kimlik/tenant kapsamı ve API sözleşmesi.
- **Query Planner:** Tedarikçi seçimi, sorgu paralelliği, timeout ve bütçe yönetimi.
- **Supplier Adapters:** Her tedarikçi için ayrı protokol/kimlik doğrulama/istek-yanıt adaptörü.
- **Canonical Catalog:** Tesis, oda, board, lokasyon ve içerik eşleştirmeleri.
- **Offer Normalizer:** Para birimi, vergi, ücret, iptal ve ödeme koşullarını ortaklaştırma.
- **Eligibility Engine:** Pazar, milliyet, kapasite, tarih, müsaitlik ve politika uygunluğu.
- **Winner Engine:** Tek en düşük fiyatlı geçerli teklifi seçme.
- **Booking Handoff:** Yalnızca kazanan teklif için yeniden doğrulama ve kesin rezervasyon isteği.
- **Observability:** Log, metrik, iz sürme, hata sınıflandırma ve denetim kaydı.

## 6. Önerilen veri sözleşmeleri

### SearchRequest

Asgari alanlar: destination/property, check-in, check-out, rooms[], adults, children ages, nationality/market, currency, locale, filters ve tenant/customer context.

### NormalizedOffer

Asgari alanlar: supplier id (yalnızca iç kullanım), property id, room id, board, occupancy, dates, availability status, cancellation policy, payment terms, base amount, taxes/fees, currency, normalized total, market eligibility, quote timestamp ve expiry/freshness bilgisi.

### Winner

Asgari alanlar: search id, winner offer reference, normalized total, display total, currency, validation timestamp ve karar/audit metadata. Kazanan dışındaki teklifler dış arayüz sözleşmesine verilmez.

## 7. Dayanıklılık, güvenlik ve performans

- Tedarikçi sorguları paralel yürütülmeli; her adaptörün timeout ve hata sınırı ayrı olmalıdır.
- Bir tedarikçinin hatası tüm aramayı gereksiz yere düşürmemeli; ancak sonuç kapsamı ve kısmi yanıt durumu doğru kaydedilmelidir.
- Cache yalnızca ürün içeriği gibi uygun verilerde kullanılmalı; canlı fiyat/müsaitlik için yaş ve geçerlilik sınırları açık olmalıdır.
- Tenant izolasyonu, rol/yetki kontrolü, hassas tedarikçi verilerinin korunması ve audit log zorunludur.
- Rezervasyon oluşturma isteği idempotency anahtarıyla korunmalı; yinelenen kesin rezervasyon istekleri engellenmelidir.
- P95 arama gecikmesi, tedarikçi timeout oranı, sonuç kapsamı, kazanan fiyat yaşı, recheck başarı oranı ve booking confirmation oranı izlenmelidir.
- Performans hedefleri gerçek tedarikçi bağlantıları ve ölçümlerle belirlenmeli; ölçülmemiş hedefler tamamlanmış özellik gibi sunulmamalıdır.

## 8. Hata davranışları

- Hiç geçerli teklif yoksa sonuç bulunamadı dön.
- Tüm tedarikçiler yanıt vermezse teknik hata/kısmi sonuç durumunu açıkça belirt.
- Kazanan teklifin recheck işlemi başarısızsa otomatik ikinci teklife geçme; yeni arama iste.
- Tedarikçi rezervasyonu reddeder veya onay vermezse rezervasyonu onaylı olarak işaretleme.
- Fiyat, para birimi, vergi veya iptal koşulu belirsizse teklifi kazanan yapma.

## 9. Mevcut kod tabanıyla ilgili başlangıç tespitleri

Önceki kod incelemesinde:

- `src/domain/search.js` içinde otel/şehir gruplama, tedarikçi uygunluğu, pazar/milliyet kontrolü, oda kapasitesi, müsaitlik, fiyat ve özel teklif değerlendirmeleri ile en düşük fiyatı seçmeye yönelik temel mantık bulundu.
- `src/domain/booking.js` içinde alış/satış rezervasyon akışı, rezervasyon kaydı, tedarikçi bildirimi, ödeme ve otomatik iptal davranışları bulundu.
- Bu başlangıç tespitleri, hedefteki tek kazanan + kazananı yeniden doğrulama + doğrudan kesin rezervasyon akışının tamamının mevcut olduğu anlamına gelmez. Kod değişikliği ve test gereklidir.

### Mevcut dokümantasyonla çelişki kontrolü

Depodaki mevcut `README.md` içinde ön ödemenin bloke edilmesi, ödenmeyen rezervasyonun otomatik iptali ve rebooking için “tutma hakkı” ifadeleri yer alıyor. Bu ifadeler yeni ürün kuralıyla kapsam bazında karşılaştırılmalıdır.

- Arama sırasında oda/stok/rezervasyon kilidi kesinlikle olmayacaktır.
- Ön ödeme muhasebe kaydı veya rebooking açık artırmasındaki ticari haklar, rezervasyon envanterini kilitleme ile aynı şey olmayabilir; bunlar ayrıca ürün kararıyla netleştirilmeden sessizce silinmemelidir.
- Kod, README, testler ve bu şartname arasındaki çelişkiler bir uyum işi olarak ele alınmalıdır.

## 10. Uygulama sırası

1. Mevcut search ve booking akışlarını testlerle haritala.
2. Hold/lock ve alternatif tedarikçiye otomatik geçiş davranışlarını kod tabanında ara.
3. Canonical property/room/board eşleştirmelerini ve teklif normalizasyonunu güçlendir.
4. Eligibility ve Winner Engine'i tek kazanan kuralına göre ayır.
5. Kazanan teklif için winner-only recheck ve doğrudan booking create akışını uygula.
6. Arama UI'sini lokasyon, tarih, occupancy, filtre, sıralama ve tesis/oda detayları açısından yenile.
7. Birim, entegrasyon ve uçtan uca testleri ekle; tedarikçi hata ve fiyat değişimi senaryolarını doğrula.
8. Canlı tedarikçi entegrasyonlarını ayrı ayrı doğrula; simülasyon/mock davranışını canlı bağlantı gibi raporlama.

## 11. Kabul kriterleri

- Arama sırasında hiçbir rezervasyon/oda/stok kilidi oluşmaz.
- Eşdeğer ve geçerli teklifler arasında yalnızca en düşük normalize toplam fiyat kazanır.
- Kazanan dışındaki teklifler kullanıcıya alternatif olarak sunulmaz ve booking akışına taşınmaz.
- Rezervasyon talebinde yalnızca kazanan tedarikçiden recheck yapılır.
- Recheck başarısızsa otomatik ikinci teklife geçilmez.
- Recheck başarılıysa kesin rezervasyon talebi gönderilir; yalnızca tedarikçi onayı sonrası onaylı durum oluşur.
- Fiyat, vergi/ücret, para birimi, iptal, ödeme, kapasite ve pazar koşulları testlerle doğrulanır.
- Her karar izlenebilir ve denetlenebilir kayıt üretir.

## 12. Çalışma ve sürüm yönetimi kuralı

Bu dosya arama motoru ve ilgili rezervasyon devri için ana teknik referanstır.

- Her yeni teknik şartname Markdown olarak depoya eklenir.
- Eski sürümler silinmez; Git geçmişi ve sürüm numarası korunur.
- Her geliştirme görevi başlamadan önce geliştirici/ajan bu dosyanın en güncel sürümünü okur.
- Görev sonunda kod, testler ve gerekiyorsa şartname birlikte güncellenir.
- GitHub'a yükleme tek başına diğer araçlara otomatik bildirim göndermez. Her çalışma oturumunda güncel dosyanın okunması zorunludur.
- Aynı dosyada eşzamanlı değişiklikten kaçınılır; geliştirmeler branch ve pull request üzerinden gözden geçirilir.

## 13. Referanslar

- Book4me search domain: https://github.com/kosker-07/Book4me/blob/main/src/domain/search.js
- Book4me booking domain: https://github.com/kosker-07/Book4me/blob/main/src/domain/booking.js
- Booking.com Demand API — accommodation search: https://developers.booking.com/demand/docs/accommodations/search-for-available-properties
- Booking.com Demand API — filtering and sorting: https://developers.booking.com/demand/docs/accommodations/filter-sorting
- Expedia Group Rapid — Shopping API: https://developers.expediagroup.com/rapid/lodging/shopping/about-shopping-api
- Expedia Group Rapid — content filtering: https://developers.expediagroup.com/rapid/lodging/content/content-filtering
- Hotelbeds — Hotel Booking API: https://developer.hotelbeds.com/documentation/hotels/booking-api/

Rakip dokümantasyonu, yetenek sınıflarını anlamak için referanstır; başka bir şirketin ürün tasarımı veya kodu kopyalanmayacaktır.
