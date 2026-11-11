# BED4BOOK ürün geliştirme şartnamesi eki

Taslak v0.2 | 11 Kasım 2026 | Ürün kapsamı, öncelik sırası ve iş kuralları

v0.1'in yerine geçer. v0.1'deki on paketin hiçbiri çıkarılmadı; sıra değişti, altı yeni paket eklendi ve ortak otel kataloğu kuralı ürün sahibinin kararıyla yeniden yazıldı.

## Yön

BED4BOOK'un önceliği DMC operasyonudur. DMC kontratını dakikalar içinde yükleyebilir, stop ve kontenjanını telefondan yönetebilir, rezervasyonunu ve carisini tek yerden işletebilirse envanter platforma gelir. Envanter platformdaysa pazar yeri dolar; pazar yeri doluysa büyük alıcılar ve dış bağlantılar kendiliğinden gelir.

Bu yüzden paketler üç aşamada teslim edilir:

| Aşama | Amaç | Paketler |
| --- | --- | --- |
| A — DMC operasyonu | DMC'nin günlük işini BED4BOOK üzerinden yürütmesi | G03, G04, G11, G12, G07, G13, G14, G15, G16 |
| B — Pazar yeri ve hesaplaşma | DMC'ler arası satışın ticari olarak tamamlanması | G05, G01, G06, G08 |
| C — Bağlantılar ve ileri ürünler | Dış tedarik ve satış, Rebooking, RateRelay | G02, G09, G10 |

Aşamalar birbirini beklemez: B aşamasındaki G05 şu an geliştiriliyor. Sıra, kaynak çakıştığında hangisinin önce biteceğini söyler. C aşaması önemini korur; A ve B'nin ürettiği envanter ve işlem hacmi olmadan doğrulanamayacağı için sona alınmıştır.

## Korunacak temel kurallar

- Platformun ticari muhatabı DMC'dir. Alt acenteleri yalnız DMC açar. Alıcı, pazar ürününün satıcısını BED4BOOK olarak görür.
- Satıcı DMC ve başka DMC'ye bağlı alt acente kimlikleri korunur. Dağıtımın hangi alıcıya hangi şartlarla yapılacağını yalnız platform belirler.
- **Otel yükleme serbesttir.** Her DMC, elinde kontratı olan her oteli kendi envanterine yükler. Aynı oteli yirmi DMC yükleyebilir; kimse başkasının kaydını beklemez, onay almaz, hazır listeden seçmek zorunda kalmaz. Otel kaydı, kontrat yüklenirken kendiliğinden oluşur.
- Aynı otel için birden çok DMC'nin ürünü varsa arama, eşdeğer ürünlerde tek en düşük toplam satış fiyatını öne çıkarır. Arama sırasında rezervasyon oluşturulmaz ve envanter tutulmaz; başarısız teyitte sessizce ikinci teklife geçilmez.
- Rebooking ile RateRelay ayrı iş akışlarıdır. Yeni tedarikçi teyidi alınmadan mevcut rezervasyon iptal edilmez.

## Paketlerin durumu

Durum, 11 Kasım 2026 itibarıyla staging dalındaki koda dayanır. Demo ekranı veya adaptör iskeleti, çalışan ticari işlev sayılmaz.

| Kod | Paket | Aşama | Durum |
| --- | --- | --- | --- |
| G03 | Kontrat yükleme ve doğrulama | A | Sunucuda yok; eski prototipte Excel, PDF ve OCR denemesi var. |
| G04 | Kontrat ve satış fiyatı motoru | A | Gece fiyatı, markup, milliyet, zorunlu iptal ve ödeme şartı var; çocuk, kampanya ve kısıtlar yok. |
| G11 | Stop sale ve kontenjan takvimi | A | Günlük fiyat ve kontenjan kaydı var; toplu ve mobil yönetim yok. |
| G12 | Sezon kopyalama | A | Yok. |
| G07 | Rezervasyon sonrası operasyon | A | Taslak, bekleyen, onay, ret, iptal var; değişiklik ve iade akışı yok. |
| G13 | Otele gönder | A | Yok. Ana şartnamede kararlaştırılmıştı. |
| G14 | Günlük operasyon listeleri | A | Yok. |
| G15 | Hatırlatmalar | A | Yok. |
| G16 | Alt acente kredi limiti ve depozito | A | Yok. |
| G05 | DMC pazar yeri ve dağıtım | B | Toplu dağıtım kuralları yayında (PR #6). Fiyat zinciri geliştiriliyor (PR #7). |
| G01 | Otomatik otel eşleştirme | B | İç kimlikler var; farklı DMC kayıtlarının aynı otel olarak gruplanması yok. |
| G06 | Kazanç ve hesaplaşma | B | Proforma var; cari ve mutabakat yok. |
| G08 | İş analitiği ve anonim kıyaslama | B | Sınırlı panel var. |
| G02 | Tedarik ve satış bağlantıları | C | İç web API'si var; gerçek dış bağlantı yok. |
| G09 | Rebooking | C | Ana şartnamede tanımlı; prototip düzeyinde. |
| G10 | RateRelay | C | Ana şartnamede tanımlı; prototip düzeyinde. |

---

# Aşama A — DMC operasyonu

## G03 Kontrat yükleme ve doğrulama

DMC'yi platforma getiren ilk iş. Hedef: otelden gelen kontrat dosyasının, elle veri girişi olmadan satışa hazır hâle gelmesi.

- G03-01 Excel, CSV, PDF ve fotoğraftan alınan otel, oda, pansiyon, periyot, fiyat ve kurallar kaynağıyla birlikte önizlemeye gelir. Her değer, alındığı sayfa, hücre veya belge bölümüyle ilişkilendirilir.
- G03-02 Dosyadaki otel sistemde yoksa otel, odaları ve pansiyonlarıyla birlikte yükleme sırasında oluşturulur. DMC'nin aynı oteli daha önce yüklediği durumda yeni kontrat mevcut otel kaydına bağlanır. Başka DMC'lerin aynı otele ait kayıtları yüklemeyi etkilemez.
- G03-03 Çok otelli dosyalar tek seferde taranır; her otel "hazır", "kontrol gerekli" veya "okunamadı" olarak listelenir. Kişi kombinasyonlarının ve pansiyon kodlarının farklı yazımları standart karşılıklarına çevrilir.
- G03-04 Düşük güven, eksik tarih, tarih boşluğu veya çakışması, çelişkili koşul ve olağan dışı fiyat incelemeye ayrılır. Yapay zekâ veya OCR eksik ticari koşulu tahminle doldurmaz.
- G03-05 Yetkili kullanıcı onayladıktan sonra sürümlü kontrat oluşur. Yüklemek kendiliğinden yayın yapmaz ve geçmiş rezervasyonların fiyatını değiştirmez.

Kabul ölçütü: Temsilî kontratlarda çıktı kaynakla karşılaştırılır; kritik fiyat veya koşul hatası yayından önce görülür. Yükleme süresi ve düzeltme oranı ölçülür.

## G04 Kontrat ve satış fiyatı motoru

Gerçek bir kontratın sisteme girebilmesi için G03 ile birlikte teslim edilir.

- G04-01 Kontrat; konaklama ve satış tarihlerini, oda ve pansiyonu, kişi dağılımını, çocuk yaşlarını, ilave yatak ve zorunlu ek bedelleri fiyata uygular.
- G04-02 Erken rezervasyon, kalış indirimi, ücretsiz gece ve diğer kampanyalar için birleşme veya hariç tutma sırası açıktır. Release, minimum ve maksimum gece, stop sale ve giriş çıkış kısıtları desteklenir.
- G04-03 Pazar ve milliyet uygunluğu fiyat yarışından önce değerlendirilir. Vergi ve zorunlu ücretin fiyata dahil olup olmadığı açıktır; toplam maliyeti belirsiz teklif kazanan olamaz.
- G04-04 Aynı ürün ve aynı şartlar, güncel kurla ortak para biriminde karşılaştırılır. Daha kârlı satıcı veya ücretli görünürlük, uygun en düşük satış fiyatının yerine geçmez.

Kabul ölçütü: Aynı kontratın farklı çocuk yaşları, kampanya birleşimleri ve pazar koşulları için beklenen toplamlar doğrulanır; koşulları farklı teklifler tek fiyat grubuna girmez.

## G11 Stop sale ve kontenjan takvimi

DMC'nin her gün yaptığı iş. Telefondan, birkaç dokunuşla yapılabilmelidir.

- G11-01 Otel, oda ve tarih aralığı seçilerek stop sale, kontenjan ve release toplu olarak güncellenir. Tek gün ve tek oda düzeltmesi aynı ekrandan yapılır.
- G11-02 Takvim; satışa açık, stop, release süresi dolmuş ve kontenjanı bitmiş günleri ayrı gösterir.
- G11-03 Stop sale kaydedildiği anda aramadan düşer. Mevcut rezervasyonlar etkilenmez. Kimin, ne zaman, hangi aralığı değiştirdiği kayıt altındadır.

Kabul ölçütü: Bir sezonluk stop ve kontenjan değişikliği telefondan tek işlemde yapılır; değişiklik sonraki aramada görünür.

## G12 Sezon kopyalama

- G12-01 Mevcut kontrat yeni sezona kopyalanır: periyotlar yeni tarihlere taşınır, fiyatlara yüzde veya sabit artış uygulanır, kurallar korunur.
- G12-02 Kopya taslak olarak açılır; DMC inceleyip onaylamadan satışa çıkmaz.

Kabul ölçütü: Bir otelin geçen sezon kontratı, artış oranı girilerek birkaç dakikada yeni sezon taslağına dönüşür.

## G07 Rezervasyon sonrası operasyon

- G07-01 Her rezervasyonun sorumlu operasyon kullanıcısı, takip zamanı ve işlem geçmişi vardır. Yaklaşan giriş, teyit eksikliği, vade ve iptal son zamanı görünür.
- G07-02 Tarih, oda, misafir veya kişi değişikliği; yeni fiyatı, cezayı ve gerekli teyidi gösteren bir işlem olarak yürütülür. İptal, no show ve iade tutarları rezervasyonda saklanan koşullara dayanır.
- G07-03 Manuel envanterde yetkili operasyon onayı korunur. Dış bağlantıyla gelen işlemde sağlayıcının kesin teyidi ve referansı olmadan rezervasyon onaylı gösterilmez.
- G07-04 Onay, değişiklik ve iptal bildirimleri işlem kaydıyla izlenir.

Kabul ölçütü: Değişiklik veya iptal sırasında müşteri taahhüdü, sağlayıcı durumu, finans kaydı ve belge tutarlı kalır; başarısız işlem tamamlanmış görünmez.

## G13 Otele gönder

- G13-01 Otel kartında otelin rezervasyon e-posta adresi tutulur. Onaylanan rezervasyon, kontratın sahibi DMC tarafından tek düğmeyle otele gönderilir.
- G13-02 Gönderen, zaman ve teslim durumu kaydedilir. Otelin onay numarası rezervasyona işlenir. Değişiklik ve iptal aynı yoldan gönderilir.
- G13-03 Adresi tanımlı olmayan otelde gönderim kapalıdır ve kullanıcı uyarılır. Otele giden yazıda alıcı acentenin ticari bilgileri ve satış fiyatı yer almaz.

Kabul ölçütü: Rezervasyon, değişiklik ve iptal otele ulaşır; her gönderimin kaydı ve otel onay numarası rezervasyonda görünür.

## G14 Günlük operasyon listeleri

- G14-01 Giriş listesi, çıkış listesi ve rooming list; tarih, otel ve duruma göre süzülür, Excel ve PDF olarak alınır.
- G14-02 "Bugün yapılacaklar" görünümü: teyit bekleyenler, opsiyonu dolanlar, vadesi gelenler, otel onay numarası eksik olanlar.

Kabul ölçütü: Operasyon kullanıcısı güne tek ekranla başlar; listedeki her satır ilgili rezervasyona açılır.

## G15 Hatırlatmalar

- G15-01 Opsiyon, ödeme vadesi, ücretsiz iptal son günü ve release tarihleri için sorumlu kullanıcıya bildirim gider. Kanal e-postadır; WhatsApp ayrı karar ve sağlayıcı anlaşmasıyla eklenir.
- G15-02 Bildirim kuralları DMC bazında açılıp kapatılır. Gönderilen her bildirim kayıt altındadır.

Kabul ölçütü: Süresi yaklaşan işlem, belirlenen süre önce doğru kullanıcıya bildirilir; aynı olay için mükerrer bildirim gitmez.

## G16 Alt acente kredi limiti ve depozito

- G16-01 DMC, her alt acentesi için kredi limiti veya depozito bakiyesi tanımlar. Limit aşılırsa rezervasyon DMC onayına düşer veya reddedilir; hangisi olacağını DMC seçer.
- G16-02 Tahsilat ve iade bakiyeye işlenir. Alt acente yalnız kendi bakiyesini görür. Kredi seçeneği kendiliğinden açılmaz.

Kabul ölçütü: Limiti dolan alt acente yeni rezervasyonu limitsiz tamamlayamaz; bakiye hareketleri rezervasyonlarla tutarlıdır.

---

# Aşama B — Pazar yeri ve hesaplaşma

## G05 DMC pazar yeri ve dağıtım

- G05-01 DMC kendi otel ürününü BED4BOOK'a tedarik eder ve alıcı yetkisiyle BED4BOOK pazarından satın alır. Alıcı DMC ve alt acente, başka bir DMC'nin envanterine eriştiğini gösteren bir kavram veya ekranla karşılaşmaz.
- G05-02 Satıcı ürününün hangi alıcı DMC'ye açılacağını ve platform payını yalnız platform operatörü belirler. DMC yalnız kendi ürününü ve kendi alt acente ağını yönetir.
- G05-03 Platform alış maliyeti, platformun DMC'ye satışı ve DMC'nin alt acentesine satışı ayrı ticari aşamalardır. Rezervasyon anındaki kural ve tutarlar sonradan değişmeden saklanır.
- G05-04 Eksik fiyat kuralı sıfır pay sayılmaz; sıfır pay ancak açık bir ticari seçimdir.

Kabul ölçütü: Aynı üründe satıcı DMC, alıcı DMC ve alt acente yalnız kendisine izinli bilgiyi görür; her ticari aşama izlenebilirdir.

## G01 Otomatik otel eşleştirme

v0.1'deki "ortak katalog" paketinin yeniden yazılmış hâlidir. Merkezî bir otel listesi yoktur ve yükleme hiçbir koşula bağlanmaz. Eşleştirme, yüklemeden sonra arka planda çalışan bir gruplama işidir; tek amacı, aynı otelin farklı DMC'lerden gelen ürünlerini aramada tek otel olarak gösterip en iyi fiyatı öne çıkarmaktır.

- G01-01 Her DMC'nin otel kaydı kendisine aittir ve bağımsızdır. Sistem; ad, adres, konum ve yıldız bilgisinden aynı tesise ait kayıtları arka planda gruplar. Gruplama DMC'ye görünmez ve DMC'den iş istemez.
- G01-02 Aramada bir grup tek otel olarak görünür. Grup içindeki eşdeğer ürünler (aynı oda, pansiyon ve koşullar) fiyatla yarışır; en düşük toplam satış fiyatı öne çıkar.
- G01-03 Belirsiz eşleşme platform operatörünün incelemesine düşer. İnceleme sonuçlanana kadar kayıt satıştan kalkmaz; kendi başına ayrı otel olarak satılmaya devam eder. Bilgi eksikliği eşitlik sayılmaz.
- G01-04 Farklı oda, pansiyon veya iptal koşulu aynı ürün gibi birleştirilmez. Operatör bir gruplamayı ayırabilir veya iki kaydı elle birleştirebilir.

Kabul ölçütü: Aynı oteli yükleyen DMC sayısından bağımsız olarak alıcı tek otel ve tek en iyi fiyat görür; hiçbir DMC'nin yüklemesi başka bir kayıt yüzünden engellenmez veya bekletilmez.

## G06 Kazanç ve hesaplaşma

- G06-01 DMC ve işlem bazında borç, alacak, ön ödeme, vade, tahsilat, iade ve mahsup izlenir. Platform ile DMC'nin kayıtları dönem ekstresinde karşılaştırılır.
- G06-02 Proforma vergi faturası veya ödeme kanıtı sayılmaz. Banka, POS, VCC, e-fatura ve muhasebe bağlantıları ayrı paket olarak etkinleştirilir.
- G06-03 Rebooking ve RateRelay kazancının hesabı ve paylaşımı (v0.1 G06-02 ve G06-03) C aşamasında, G09 ve G10 ile birlikte teslim edilir. Örnek: eski maliyet 1.000 EUR, yeni maliyet 930 EUR, ilave gider 15 EUR ise net tasarruf 55 EUR'dur; paylaşım yalnız tanımlı kurala göre ve kesinleşince yapılır.

Kabul ölçütü: Tahakkuk, ödeme ve iade toplamları işlem ve dönem kayıtlarıyla tutarlıdır.

## G08 İş analitiği ve anonim kıyaslama

- G08-01 DMC ve platform; kendi satışını, net katkısını, iptalini, ürün dönüşümünü ve işlem süresini yetkisine göre izler. Bu bölüm B aşamasında teslim edilir.
- G08-02 Anonim pazar kıyası, yeterli sayıda bağımsız DMC platformda olduğunda açılır. Toplulaştırılmış ve gerektiğinde gecikmeli endekslerle verilir; başka DMC'nin kimliği, ham teklifi veya alış fiyatı gösterilmez.
- G08-03 Asgari katılımcı sayısı, gecikme ve filtre politikası belirlenmeden dış kıyas yayınlanmaz. Dar sorgularla tek bir DMC'nin fiyatını çıkarmaya imkân veren sonuçlar gizlenir.

Kabul ölçütü: Az katılımcılı veya dar filtreli veride rakip fiyatı çıkarılamaz.

---

# Aşama C — Bağlantılar ve ileri ürünler

Bu paketlerin kuralları v0.1'deki ve ana şartnamedeki hâliyle geçerlidir; burada özetlenmiştir. Ayrıntı için "Rebooking ve RateRelay gereksinimleri" belgesi esas alınır.

## G02 Tedarik ve satış bağlantıları

- G02-01 Her bağlantı; ticari erişimi, ürün kapsamı, izinleri ve sağlayıcı işlem kurallarıyla tanımlanır.
- G02-02 Dış alıcıya yalnız izinli ürün ve kendi satış fiyatı verilir. İç tedarik kimlikleri ve maliyetler dış yanıtlara taşınmaz.
- G02-03 Süresi dolmuş fiyat son teyitsiz kullanılmaz. Yanıtı belirsiz rezervasyon, sorguyla çözülmeden yeniden gönderilmez. Tekrar denemeler mükerrer işlem üretmez.

Kabul ölçütü: Bir tedarikçi ve bir alıcı için test ortamında uçtan uca işlem kanıtı sunulur.

## G09 Rebooking

- G09-01 Sistem mevcut rezervasyon için eşdeğer ve daha avantajlı ürünü değerlendirir; oda, pansiyon, tarih, kişi, vergiler, milliyet, iptal, ödeme ve no show şartları karşılaştırılır.
- G09-02 İşlem, giderler sonrası onaylanan asgari net kazancı sağlamalıdır. Öneri modu ile otomatik mod ayrıdır; yetki, kapsam ve eşik tanımlanmadan sistem rezervasyonu değiştirmez.
- G09-03 Yeni rezervasyon teyit edilip sağlayıcı referansı doğrulanmadan eski rezervasyonun iptali istenmez.
- G09-04 Yeni teyit başarısızsa eski rezervasyon korunur. Eski iptal başarısızsa iki yükümlülük açıkça gösterilir ve mutabakat açılır.

Kabul ölçütü: Öneri modu ticari değişiklik yapmaz; mükerrer rezervasyon oluşmaz.

## G10 RateRelay

- G10-01 Uygun rezervasyon, platformun belirlediği DMC'lere fiyat verebilecekleri operasyon bilgisiyle açılır. Kaynak acente, mevcut tedarikçi, diğer DMC'ler, teklifleri, teklif sayısı ve sıralaması gizlidir.
- G10-02 İlk geçerli teklif 24 saatlik süreyi başlatır; daha iyi geçerli teklif süreyi yenileyebilir. Kapanış, kesin iptal son zamanından güvenlik payı düşülerek bulunan sınırı aşamaz.
- G10-03 Tek en düşük, uygun ve tüm giderleri karşılaştırılabilir teklif kazanır. Kazananın yeni rezervasyonu teyit edilmeden kaynak rezervasyon iptal edilmez.
- G10-04 Aynı rezervasyonda Rebooking ile RateRelay eşzamanlı tedarik değişikliği yapamaz. Geçerli teklif yoksa mevcut rezervasyon korunur.

Kabul ölçütü: Süre, yenileme, güvenli kapanış, eşitlik ve başarısız devir senaryoları doğrulanır; katılımcılar diğer teklifleri veya kimlikleri hiçbir çıktıdan öğrenemez.

---

## Tamamlanma kanıtları

Her paket, aşağıdaki senaryolar için sonuç ve kanıtla teslim edilir. Demo sonucu, gerçek işlem kanıtından ayrı gösterilir.

| Kabul | Aşama | Gözlenmesi gereken sonuç |
| --- | --- | --- |
| K01 İçe aktarma | A | Kaynak belge ile okunan fiyat eşleşir; otel kendiliğinden oluşur; belirsiz alan incelemeye gelir. |
| K02 Fiyat | A | Çocuk, kampanya, ek ücret ve milliyet örnekleri beklenen toplamı üretir. |
| K03 Takvim | A | Toplu stop ve kontenjan değişikliği telefondan yapılır ve aramaya yansır. |
| K04 Operasyon | A | Değişiklik, iptal ve otele gönderim sonucu rezervasyon, finans ve belgede tutarlıdır. |
| K05 Kredi | A | Limiti dolan alt acente limitsiz rezervasyon tamamlayamaz. |
| K06 Serbest yükleme | B | Aynı oteli birden çok DMC engelsiz yükler; alıcı tek otel ve tek en iyi fiyat görür. |
| K07 Tek kazanan | B | Aramada stok tutulmaz; kazanan başarısızsa ikinci teklife otomatik geçilmez. |
| K08 Ticari zincir | B | Platform ile DMC aşamalarının tutarları ve görünürlüğü doğru ayrılır. |
| K09 Gizlilik | B | API, PDF, bildirim, dışa aktarma ve kayıtlarda karşı DMC verisi açığa çıkmaz. |
| K10 Hesaplaşma | B | Tahakkuk, ödeme ve iade toplamları dönem kayıtlarıyla tutarlıdır. |
| K11 Canlı bağlantı | C | Sağlayıcı test ortamı ve pilot işlemler referanslarıyla doğrulanır. |
| K12 Rebooking ve RateRelay | C | Yeni teyit eski iptalden önce gelir; süre ve tek kazanan kuralları uygulanır; mükerrer devir oluşmaz. |

### Üstünlük iddiasının ölçülmesi

Pilot öncesinde başlangıç değerleri kaydedilir. Ölçülecekler: kontrat yükleme süresi, düzeltme oranı, stop sale güncelleme süresi, rezervasyon teyit başarısı, operasyon çözüm süresi ve gider sonrası net katkı. Ölçülmüş karşılaştırma olmadan belirli bir rakipten daha ucuz, daha hızlı veya daha güvenilir olunduğu ilan edilmez.

## Açık ticari kararlar

İlgili karar tamamlanana kadar o karara bağlı otomatik işlem etkinleştirilmez.

| Karar | Aşama | Netleştirilecek konu |
| --- | --- | --- |
| D01 Kontrat örnekleri | A | G03 için esas alınacak gerçek kontrat dosyaları ve hedef otel sayısı. |
| D02 Kampanya sırası | A | İndirimlerin birleşme ve hariç tutma kuralları. |
| D03 Bildirim kanalı | A | WhatsApp'ın eklenip eklenmeyeceği ve sağlayıcısı. |
| D04 Limit aşımı | A | Varsayılan davranış: DMC onayına düşmek mi, reddetmek mi. |
| D05 Fiyat zinciri | B | Platform payı, DMC payı ve değişiklik tarihi kuralları. |
| D06 Eşleştirme eşiği | B | Otomatik gruplamanın hangi güven düzeyinde incelemeye düşeceği. |
| D07 Anonim analiz | B | Asgari bağımsız DMC sayısı, veri gecikmesi ve dar filtre sınırı. |
| D08 İlk bağlantı | C | İlk sağlayıcı ve alıcı, erişim izinleri ve pilot kapsamı. |
| D09 Net kazanç paylaşımı | C | Hak sahipleri, oranlar, kesinleşme zamanı ve düzeltme. |
| D10 RateRelay kuralları | C | Avantaj eşikleri, güvenli kapanış payı, eşit teklifler, teklif değişikliği ve katılım. |

## v0.1'den farklar

- Paketler önem sırasına göre değil DMC'ye fayda sırasına göre üç aşamaya ayrıldı. Hiçbir paket çıkarılmadı.
- G01 yeniden yazıldı: merkezî katalog ve yükleme öncesi eşleştirme yerine serbest yükleme ve arka planda otomatik gruplama.
- G03'e otelin kontrat yüklenirken kendiliğinden oluşması eklendi.
- Altı yeni paket eklendi: G11 takvim, G12 sezon kopyalama, G13 otele gönder, G14 operasyon listeleri, G15 hatırlatmalar, G16 kredi limiti.
- G06'nın Rebooking ve RateRelay kazanç paylaşımı C aşamasına, G08'in anonim kıyası yeterli katılımcı koşuluna bağlandı.
- G09 ve G10 özetlendi; ayrıntılı kuralları kaynak belgede aynen geçerlidir.

### Esas alınan belgeler

- docs/BED4BOOK_Teknik_Sartname.md (v1.0)
- docs/BED4BOOK_Proje_Sartnamesi.md (v1.0)
- docs/BED4BOOK_MASTER_TECHNICAL_SPEC.md (v1.1)
- docs/Cloude_Book4me_Arama_Motoru_Teknik_Sartname.md (v1.0)
- docs/BED4BOOK_Rebooking_RateRelay_Teknik_Sartname.md
- 11 Kasım 2026 pazar karşılaştırması ve ürün sahibi kararları
