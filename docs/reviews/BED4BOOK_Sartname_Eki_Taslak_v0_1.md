# BED4BOOK ürün geliştirme şartnamesi eki

Taslak v0.1 | 11 Kasım 2026 | Ürün kapsamı ve iş kuralları

BED4BOOK, DMC’nin kontratını satışa açmasını, pazardan ürün satın almasını, rezervasyonunu işletmesini ve net kazancını izlemesini aynı platformda birleştirecektir. Bu ek, hedef ürünü on geliştirme başlığıyla tanımlar. Rekabet üstünlüğü fiyat, operasyon süresi, işlem başarısı ve net katkı üzerinden ölçülecektir.

Bu metin bir kapsam taslağıdır. Mevcut ilk ticari sürümün manuel otel envanteri, alt acente satışı, Back Office ve voucher teslimi korunur. Sonraki modüller, aşağıdaki bağımlılık sırasıyla ayrı teslim paketleri olarak ele alınır. Her madde hedef davranışı ifade eder; tamamlanma durumu uygulama ve işlem kanıtıyla ayrıca belirlenir.

### Mevcut şartnamelere yerleştirme

| Belge | Önerilen ekleme |
| --- | --- |
| Proje Şartnamesi v1.0 | Bölüm 4 teslimatlar ve bölüm 9 sonraki fazlar, G01 ile G10 arasındaki paketlere referans verecek şekilde genişletilir. |
| Teknik Şartname v1.0 | Bölüm 4 altında 4.5 ile 4.14 arasında yeni alt başlıklar; bölüm 7 gizlilik, bölüm 8 kabul ve bölüm 10 açık kararlar güncellenir. |
| Master Technical Specification v1.1 | Bölüm 3 Rebooking ve bölüm 4 RateRelay bu ekle ayrıntılandırılır. Ortak kurallar ve açık kararlar tek referanstan yönetilir. |
| Arama motoru şartnamesi v1.0 | Ortak katalog, eşdeğerlik, tek kazanan ve kazananı yeniden teyit etme kuralları G01, G02 ve G04 ile birlikte uygulanır. |

### Korunacak temel kurallar

- Platformun ticari muhatabı DMC’dir. Alt acenteleri yalnız DMC açar. Alıcı, pazar ürününün sağlayıcısını BED4BOOK olarak görür.
- Satıcı DMC ve başka DMC’ye bağlı alt acente kimlikleri korunur. Dağıtımın hangi alıcıya hangi şartlarla yapılacağını yalnız platform belirler.
- Arama sırasında rezervasyon oluşturulmaz ve envanter tutulmaz. Uygun eşdeğer ürünlerde tek en düşük toplam satış fiyatı kazanır; başarısız teyitte sessizce ikinci teklife geçilmez.
- Rebooking ile RateRelay ayrı iş akışlarıdır. Yeni tedarikçi teyidi alınmadan mevcut rezervasyon iptal edilmez.

## Geliştirme paketleri ve teslim sırası

Durum değerlendirmesi, geliştirme dalındaki kaynak kodu ve güncel şartnamelere dayanır. Demo ekranı veya adaptör iskeleti, çalışan ticari entegrasyon olarak kabul edilmez.

| Kod | Geliştirme paketi | Durum ve sıra |
| --- | --- | --- |
| G01 | Ortak otel ve oda kataloğu | İç ürün kimlikleri var; kaynaklar arası eşleştirme genişletilecek. Bağlantı paketi. |
| G02 | Tedarik ve satış bağlantıları | İç web API’si var; gerçek dış bağlantılar sonraki paket. |
| G03 | Kontrat yükleme ve doğrulama | Excel, PDF ve OCR demo temeli var; sunucu iş akışına taşınacak. |
| G04 | Kontrat ve satış fiyatı motoru | Gece fiyatı, markup ve milliyet temeli var; ayrıntılı kurallar eklenecek. |
| G05 | DMC pazar yeri ve dağıtım | Dağıtım kuralları var; DMC alıcı yolculuğu ve gelir zinciri tamamlanacak. |
| G06 | Kazanç ve hesaplaşma | Proforma mevcut; net kazanç, cari ve mutabakat derinleştirilecek. |
| G07 | Rezervasyon sonrası operasyon | Durum yönetimi var; değişiklik, iade ve dış teyit işlemleri genişletilecek. |
| G08 | İş analitiği ve anonim kıyaslama | Sınırlı panel ve demo analiz var; güvenilir ölçüm ürünü geliştirilecek. |
| G09 | Rebooking | Ana şartnamede var; gerçek tedarikçi ve kalıcı işlem altyapısıyla tamamlanacak. |
| G10 | RateRelay | Ana şartnamede var; anonim teklif, süre ve devir işlemleri tamamlanacak. |

### Bağımlılık sırası

- İlk adım: mevcut manuel satış çekirdeğini pilotta doğrula. Pazar satışını açmadan önce G05 kapsamındaki alıcı rolünü, fiyat zincirini ve gizliliği tamamla.
- İkinci adım: G01 ve G02 ile ilk gerçek bağlantıyı kur. G03 ve G04’ü hedef kontrat örnekleri üzerinden genişlet. G06 ve G07’yi gerçek işlem sonuçlarıyla tamamla.
- Üçüncü adım: G08 için güvenilir veri üret. G09’u öneri modunda doğrula; ardından kontrollü otomasyonu ve G10 teklif havuzunu pilotla aç.

İlk sürüm ve her ek paket için ayrı tamamlanma kaydı tutulur. Gelişmiş modüllerin eklenmesi, mevcut teslimatın yeniden başlatılması veya hepsinin tek yayına bağlanması anlamına gelmez.

## Katalog bağlantı ve kontrat hazırlama

### G01 Ortak otel ve oda kataloğu

Mevcut durum: Sunucu iç kimliklerle çalışıyor; farklı DMC kayıtlarının ortak tesis ve oda kimliğinde birleşmesi tamamlanmış değil.

- G01-01 Aynı tesisin farklı kaynak kayıtları ortak tesis kimliğine bağlanacaktır. Oda, yatak, manzara, pansiyon ve dahil hizmetler karşılaştırılabilir biçimde tutulacaktır.
- G01-02 Eşleştirme; adres, konum ve ürün ayrıntılarıyla doğrulanacaktır. Belirsiz eşleştirme incelemeye ayrılacak; sistem bilgi eksikliğini eşitlik kabul etmeyecektir.
- G01-03 Kaynak kaydı ve güncelleme zamanı izlenebilir kalacaktır. Harici eşleştirme hizmeti kullanılırsa kalite ve maliyet kendi katalog örneklerimizle değerlendirilecektir.

Kabul ölçütü: Aynı tesis birden çok kaynaktan geldiğinde çoğalmaz; farklı oda, pansiyon veya iptal koşulu aynı ürün gibi birleştirilmez.

### G02 Tedarik ve satış bağlantıları

Mevcut durum: Dış tedarikçi ve alıcı adaptörleri gerçek ticari işlemle doğrulanmayı bekliyor.

- G02-01 Her bağlantı; ticari erişimi, ürün kapsamı, izinleri ve sağlayıcı işlem kurallarıyla tanımlanacaktır. Arama, son teyit, rezervasyon, sorgu ve iptal destekleri açıkça belirtilecektir.
- G02-02 Dış alıcıya yalnız izinli ürün ve kendi satış fiyatı verilecektir. BED4BOOK’un iç tedarik kimlikleri ve maliyetleri dış yanıtlara taşınmayacaktır.
- G02-03 Süresi dolmuş fiyat son teyitsiz kullanılmayacaktır. Yanıtı belirsiz rezervasyon, sorguyla çözülmeden yeni rezervasyon gibi tekrar gönderilmeyecektir. Tekrar denemeler mükerrer işlem üretmeyecektir.

Kabul ölçütü: Bir tedarikçi ve bir alıcı için test ortamında uçtan uca işlem kanıtı sunulur; bağlantı hatası veya zaman aşımı yanlış onay oluşturmaz.

### G03 Kontrat yükleme ve doğrulama

Mevcut durum: Excel, PDF ve fotoğraftan veri okuma demo kodunda mevcut.

- G03-01 Excel, CSV, PDF ve görselden alınan fiyat ve kurallar kaynağıyla birlikte önizlemeye getirilecektir. Sistem oda, tarih, para birimi ve kural alanlarını belge veya hücreyle ilişkilendirecektir.
- G03-02 Düşük güven, eksik tarih, çelişkili koşul ve olağan dışı fiyatlar incelemeye ayrılacaktır. AI veya OCR eksik ticari koşul uydurmayacaktır.
- G03-03 Yetkili kullanıcı doğruladıktan sonra sürümlü kontrat oluşturulacaktır. Belge yüklemek otomatik yayın veya geçmiş rezervasyon fiyatını değiştirme işlemi yapmayacaktır.

Kabul ölçütü: Temsilî kontratlarda çıktı kaynakla karşılaştırılır; kritik fiyat veya koşul hatası yayınlanmadan görülür. Yükleme süresi ve düzeltme oranı ölçülür.

## Fiyatlama ve DMC pazar yeri

### G04 Kontrat ve satış fiyatı motoru

Mevcut durum: Günlük fiyat, yüzde veya sabit markup ve milliyet uygunluğu temeli mevcut.

- G04-01 Kontrat; konaklama ve satış tarihlerini, oda ve pansiyonu, kişi dağılımını, çocuk yaşlarını, ilave yatak ve zorunlu ek bedelleri fiyatlamaya uygulayacaktır.
- G04-02 Erken rezervasyon, kalış indirimi, ücretsiz gece ve diğer kampanyalar için birleşme veya hariç tutma sırası açık olacaktır. Release, minimum veya maksimum gece, satış durdurma ve giriş çıkış kısıtları desteklenecektir.
- G04-03 Pazar ve milliyet uygunluğu fiyat yarışından önce değerlendirilecektir. Vergi ve zorunlu ücretin fiyata dahil olup olmadığı açık olacaktır; toplam maliyet belirsizse teklif kazanan yapılamayacaktır.
- G04-04 Aynı ürün ve aynı şartlar, güncel kurla ortak para biriminde karşılaştırılacaktır. Daha kârlı satıcı veya ücretli görünürlük, uygun en düşük satış fiyatının yerine geçmeyecektir.

Kabul ölçütü: Aynı kontratın farklı çocuk yaşları, kampanya birleşimleri ve pazar koşulları için beklenen toplamları doğrulanır; koşulları farklı teklifler tek fiyat grubuna girmez.

### G05 DMC pazar yeri ve dağıtım

Mevcut durum: Toplu açma kapama kuralları var. Kural üzerinden satışın kâr zinciri sonraki aşamaya bırakılmış.

- G05-01 DMC kendi otel ürününü BED4BOOK’a tedarik edebilecek ve alıcı yetkisiyle BED4BOOK pazarından satın alabilecektir. Alıcı DMC ve alt acente, başka bir DMC’nin envanterine eriştiği bir kavram veya ekranla karşılaşmayacaktır.
- G05-02 Satıcı ürününü hangi alıcı DMC’ye açacağını ve platform fiyatını yalnız platform operatörü belirleyecektir. DMC yalnız kendi ürününü ve kendi alt acente ağını yetkisi kapsamında yönetecektir.
- G05-03 Platform alış maliyeti, platformun DMC’ye satışı ve DMC’nin alt acentesine satışı ayrı ticari aşamalar olacaktır. Her aşamanın fiyat veya pay kuralı kapsamı, geçerlilik tarihi ve sürümüyle tanımlanacaktır.
- G05-04 Eksik fiyat kuralı sıfır markup kabul edilmeyecektir. Sıfır markup ancak açık bir ticari seçim olarak kullanılabilecektir. Rezervasyon anındaki kural ve tutarlar sonradan değişmeden saklanacaktır.

Kabul ölçütü: Aynı üründe satıcı DMC, alıcı DMC ve alt acente yalnız kendisine izinli bilgiyi görür; hesaplanan her ticari aşama izlenebilir ve onaylanan örnekle tutarlıdır.

## Hesaplaşma ve rezervasyon yönetimi

### G06 Kazanç ve hesaplaşma

Mevcut durum: Proforma ve fiyat görüntüsü mevcut; tam cari ve otomatik mutabakat tamamlanmış değil.

- G06-01 DMC ve işlem bazında borç, alacak, ön ödeme, vade, tahsilat, iade ve mahsup izlenecektir. Platform ile DMC’nin kayıtları dönem özetinde karşılaştırılacaktır.
- G06-02 Rebooking ve RateRelay kazancı; aynı para biriminde eski yükümlülükten yeni maliyet ve tüm ilave iptal, ödeme, kur ve işlem giderlerinin çıkarılmasıyla hesaplanacaktır. Tahminî tasarruf, kesinleşmiş kazançtan ayrı gösterilecektir.
- G06-03 Paylaşılabilir net kazanç, onaylanan kural sürümüne göre taraflara dağıtılacaktır. Oran, hak sahibi, tahakkuk zamanı ve iptal veya iade düzeltmesi iş kararıyla belirlenecektir; sabit bir paylaşım oranı varsayılmayacaktır.
- G06-04 Proforma vergi faturası veya ödeme kanıtı sayılmayacaktır. Banka, POS, VCC, e-fatura ve muhasebe bağlantıları ayrı paket olarak etkinleştirilecektir. Kredi seçeneği kendiliğinden açılmayacaktır.

Kabul ölçütü: Örnek işlemde eski maliyet 1.000 EUR, yeni maliyet 930 EUR ve ilave gider 15 EUR ise net tasarruf 55 EUR olur. Paylaştırma, yalnız tanımlanmış kurala göre ve kesinleşme koşulu sağlanınca yapılır.

### G07 Rezervasyon sonrası operasyon

Mevcut durum: Taslak, bekleyen, onay, ret ve iptal durumları var; kapsamlı değişiklik ve iade akışı genişletilecek.

- G07-01 Her rezervasyonun sorumlu operasyon kullanıcısı, takip zamanı ve işlem geçmişi olacaktır. Yaklaşan giriş, teyit eksikliği, vade ve iptal son zamanı görünür olacaktır.
- G07-02 Tarih, oda, misafir veya kişi değişikliği; yeni fiyatı, cezayı ve gerekli teyidi gösteren bir işlem olarak yürütülecektir. İptal, no show ve iade tutarları rezervasyonda saklanan koşullara dayanacaktır.
- G07-03 Manuel envanterde yetkili operasyon onayı korunacaktır. Harici bağlantıyla gelen işlemde sağlayıcının kesin teyidi ve referansı olmadan rezervasyon onaylı gösterilmeyecektir.
- G07-04 Onay, değişiklik ve iptal bildirimleri işlem kaydıyla izlenecektir. PMS veya otel aktarımı DMC’nin yetkili bağlantısıyla yürütülecek; gerekli bilgiler yalnız ilgili operasyon tarafına açılacaktır.

Kabul ölçütü: Değişiklik veya iptal sırasında müşteri taahhüdü, sağlayıcı durumu, finans kaydı ve belge tutarlı kalır; başarısız işlem tamamlanmış görünmez.

## Analitik ve Rebooking

### G08 İş analitiği ve anonim kıyaslama

Mevcut durum: Temel panel ve eski demoda anonim fiyat analizi var.

- G08-01 DMC ve platform; kendi satışını, net katkısını, iptalini, ürün dönüşümünü ve işlem süresini yetkisine göre izleyecektir. Bağlantı yanıt süresi, fiyat değişimi ve teyit başarısı ölçülecektir.
- G08-02 Pazar kıyası ayrı analiz ekranında, eşdeğer ürünlerden üretilen toplulaştırılmış ve gerektiğinde gecikmeli endekslerle verilecektir. Başka DMC’nin kimliği, ham teklifi veya alış fiyatı gösterilmeyecektir.
- G08-03 Asgari bağımsız katılımcı sayısı, gecikme ve filtre politikası belirlenmeden dış kıyas yayınlanmayacaktır. Daraltılmış sorgularla tek bir DMC’nin fiyatını çıkarmaya imkân veren sonuçlar gizlenecektir.

Kabul ölçütü: Az katılımcılı veya dar filtreli veride rakip fiyatı çıkarılamaz; satış aramasının kazanan dışı teklifleri analiz adı altında kullanıcıya açılmaz.

### G09 Rebooking

Mevcut durum: Master şartnamede mevcut; adaptör prototipi gerçek bağlantı ve kalıcı işlem altyapısıyla tamamlanacak.

- G09-01 Sistem mevcut rezervasyon için eşdeğer ve daha avantajlı ürünü değerlendirecektir. Oda ve yatak, pansiyon, tarih, kişi ve çocuk yaşı, dahil hizmetler, vergiler, milliyet, iptal, ödeme ve no show şartları karşılaştırılacaktır.
- G09-02 İşlem, giderler sonrası onaylanan asgari net kazanç koşulunu sağlamalıdır. Öneri ve otomatik mod ayrı olacaktır. Otomatik yetki, kapsam ve eşik tanımlanmadan sistem rezervasyonu değiştirmeyecektir.
- G09-03 Seçilen teklif tekrar teyit edilir, yeni rezervasyon oluşturulur ve sağlayıcı onayı ile referansı doğrulanır. Eski rezervasyonun iptali ancak bu aşamadan sonra istenir.
- G09-04 Yeni teyit başarısızsa eski rezervasyon korunur. Eski iptal başarısızsa iki yükümlülük açıkça gösterilir ve operasyon mutabakatı açılır. Sistem ikinci kazanana geçmez; çözülmemiş rezervasyonu yeniden optimizasyona sokmaz.

Kabul ölçütü: Öneri modu ticari değişiklik yapmaz. Yeni teyit ve eski iptal sırası, hata durumları ve tekrar denemeler gerçek sağlayıcı test ortamında doğrulanır; mükerrer rezervasyon oluşmaz.

## RateRelay anonim teklif ve rezervasyon devri

### G10 RateRelay

Mevcut durum: Master şartnamede ayrı modül; prototipin süre ve devir davranışı şartnameyle tam uyumlu hâle getirilecek.

- G10-01 Uygun mevcut rezervasyon, platformun belirlediği katılım kapsamındaki DMC’lere fiyat verebilecekleri operasyon bilgileriyle açılacaktır. Kaynak acente, mevcut tedarikçi, diğer DMC kimlikleri, teklifleri, teklif sayısı ve sıralaması katılımcılardan gizlenecektir.
- G10-02 Katılımcı yalnız kendi teklifini ve izinli durumunu görebilecektir. Gizlilik; arayüz, dış API, belge, bildirim ve erişilebilir işlem kayıtlarında aynı kapsamda uygulanacaktır.
- G10-03 Teklif toplamı; para birimi, geçerlilik, vergi ve zorunlu ücretler ile gerekli iptal, ödeme ve diğer ticari koşulları içerecektir. Eşdeğerliği veya maliyeti belirsiz teklif kazanamayacaktır. Gider sonrası net avantaj koşulunu sağlamayan teklif otomatik devirde kazanamayacaktır.
- G10-04 İlk geçerli teklif 24 saatlik süreyi başlatacaktır. Havuz kaydının oluşturulması tek başına bu süreyi başlatmayacaktır. Daha iyi geçerli teklif, kapanışı yeni tekliften itibaren 24 saate yenileyebilecektir.
- G10-05 Kapanış, kesin iptal son zamanından onaylanan güvenlik payı çıkarılarak hesaplanan sınırı aşmayacaktır. Sınır yakındaysa yeni 24 saat beklenmeyecektir. Zamanlar ve zaman dilimi doğru kaydedilecek; süre sunucu yeniden başlasa da korunacaktır.
- G10-06 Tek en düşük, uygun, tüm giderleri karşılaştırılabilir teklif kazanacaktır. Eşitlik politikası, teklif güncelleme veya çekme kuralları önceden belirli olacaktır. Kararı eksik bir eşitlikte otomatik devir yapılmayacaktır.
- G10-07 Kazanan DMC’nin yeni rezervasyonu teyit edilmeden kaynak rezervasyon iptal edilmeyecektir. Teyit başarısızsa eski rezervasyon korunur. Kaynak iptal başarısızsa mutabakat işi açılır; ikinci kazanan veya paralel devir başlatılmaz.
- G10-08 Aynı rezervasyonda Rebooking ile RateRelay eşzamanlı tedarik değişikliği yapamayacaktır. Bu işlem denetimi, arama sırasında envanter tutma anlamına gelmeyecektir. Geçerli teklif yoksa mevcut rezervasyon korunacaktır.

Kabul ölçütü: İlk teklif ve daha iyi teklif zamanları, güvenli kapanış, yeniden başlatma, eşitlik, eşzamanlı işlem ve başarısız devir senaryoları doğrulanır. Katılımcılar diğer teklifleri veya kimlikleri hiçbir çıktıdan öğrenemez.

### Katılım ve eski uygulamalar

Eski modüldeki tedarikçiye eşitleme hakkı, rakip fiyatını veya sıralamayı gösterme ve onaysız tedarikçi değiştirme davranışları bu akışa taşınmayacaktır. Kaynak DMC’nin teklif verip veremeyeceği ve ek katılım koşulları, açık karar kaydında netleştirilecektir.

## Tamamlanma kanıtları ve rekabet ölçümü

Her paket, aşağıdaki senaryolar için sonuç ve kanıtla teslim edilir. Mock veya demo sonucu, gerçek bağlantı kanıtından ayrı gösterilir. Bu liste işlevsel kabul beklentisidir; veri modeli, migration, API uçları veya ayrıntılı test tasarımı değildir.

| Kabul | Gözlenmesi gereken sonuç |
| --- | --- |
| K01 Katalog | Aynı tesis farklı kaynakta tekilleşir; farklı oda veya koşul yanlış birleştirilmez. |
| K02 İçe aktarma | Kaynak belge ve okunan fiyat eşleşir; belirsiz alan yetkili incelemesine gelir. |
| K03 Fiyat | Çocuk, kampanya, ek ücret ve milliyet örnekleri beklenen toplamı üretir. |
| K04 Tek kazanan | Aramada stok tutulmaz; kazanan başarısızsa ikinci teklife otomatik geçilmez. |
| K05 Ticari zincir | Platform ile DMC aşamalarının tutarları ve görünürlüğü doğru ayrılır. |
| K06 Hesaplaşma | Tahakkuk, ödeme, iade ve pay toplamları işlem ve dönem kayıtlarıyla tutarlıdır. |
| K07 Operasyon | Değişiklik veya iptal sonucu sağlayıcı, finans ve belgede tutarlı görünür. |
| K08 Gizlilik | API, PDF, bildirim, dışa aktarma ve erişilebilir kayıtlarda karşı DMC verisi açığa çıkmaz. |
| K09 Rebooking | Yeni teyit eski iptalden önce gelir; hata eski rezervasyonu korur veya mutabakat açar. |
| K10 RateRelay | İlk teklif süresi, yenileme, güvenli kapanış ve tek kazanan kuralları uygulanır. |
| K11 Dayanıklılık | Tekrar, zaman aşımı, eşzamanlılık ve yeniden başlatma mükerrer devir oluşturmaz. |
| K12 Canlı bağlantı | İlgili sağlayıcı test ortamı ve seçili pilot işlemleri referanslarıyla doğrulanır. |

### Üstünlük iddiasının ölçülmesi

Pilot öncesinde başlangıç değerleri kaydedilecektir. Temsilî örneklerde kontrat hazırlama süresi, düzeltme oranı, eşdeğer son fiyat, rezervasyon teyit başarısı, operasyon çözüm süresi ve gider sonrası net katkı ölçülecektir. Rebooking ve RateRelay için tahminî tasarruf, gerçekleşen tasarruf ve başarısız işlem gideri ayrı izlenecektir.

Sayısal hedefler, örneklem ve ölçüm dönemi ürün sahibiyle belirlenerek kabul kaydına yazılacaktır. Ölçülmüş karşılaştırma olmadan belirli bir rakipten daha ucuz, daha hızlı veya daha güvenilir olunduğu ilan edilmeyecektir.

## Açık ticari kararlar ve belge ilişkileri

Aşağıdaki değerler taslakta sabitlenmemiştir. İlgili karar tamamlanana kadar o karara bağlı otomatik işlem etkinleştirilmez; mevcut manuel satış çekirdeği kendi kabul koşullarıyla ilerler.

| Karar | Netleştirilecek konu |
| --- | --- |
| D01 Fiyat zinciri | Platform alış ve satış kuralı, DMC satış kuralı, komisyon veya pay kapsamı ve değişiklik tarihi. |
| D02 Net kazanç paylaşımı | Hak sahipleri, oranlar, kesinleşme zamanı, iptal veya iade düzeltmesi ve dönem hesabı. |
| D03 Avantaj eşikleri | Rebooking ve RateRelay için ayrı asgari net kazanç, kur kaynağı, kur güncelliği ve otomatik işlem kapsamı. |
| D04 Güvenli kapanış | Sağlayıcı iptal son zamanından düşülecek güvenlik payı ve yakın süre davranışı. |
| D05 Eşit teklifler | Öneri: en erken geçerli teklif, ardından kararlı kayıt sırası. Nihai kural ürün sahibince belirlenecek. |
| D06 Teklif değişikliği | Güncelleme, geri çekme ve daha iyi teklifin süreyi yenileme koşulları. |
| D07 Katılım | Kaynak DMC’nin teklif hakkı ve uygun DMC kapsamı. Teminat veya risk grubu kısıtı ayrıca karar verilmeden eklenmez. |
| D08 Anonim analiz | Asgari bağımsız DMC sayısı, veri gecikmesi, endeks yöntemi ve dar filtrelerin sınırı. |
| D09 İşlem altyapısı | İlk sağlayıcı ve alıcı, erişim izinleri, kesin teyit ve iptal yetenekleri, pilot kapsamı. |
| D10 Kabul hedefleri | Kontrat örnekleri, ölçüm dönemi, başarı ölçütleri ve paketleri açma sorumluları. |

### Sürüm ve uygulama ilişkisi

Orijinal PDF aktarımları kaynak belge olarak korunacaktır. Kabul edilen ek, ayrı sürümlü şartname dosyasıyla ilişkilendirilecek; ilgili ana belgelerde referans ve değişiklik kaydı açılacaktır. Ortak kurallar tek bir ana referansa dayanacak, eski Rebooking uygulamaları için kontrollü geçiş tanımlanacaktır.

Bu teslimat işlevsel şartname taslağıdır. Kod uygulaması, ayrıntılı veri veya API tasarımı ve yayınlama ayrı çalışma adımlarıdır. Rakiplerden edinilen yetenek fikri BED4BOOK’un kendi iş modeline uyarlanacaktır.

### Esas alınan belgeler

- [Teknik Şartname v1.0](https://github.com/kosker-07/Book4me/blob/e34f869453d1e810907057152383e1f22efaa412/docs/BED4BOOK_Teknik_Sartname.md)
- [Proje Şartnamesi v1.0](https://github.com/kosker-07/Book4me/blob/e34f869453d1e810907057152383e1f22efaa412/docs/BED4BOOK_Proje_Sartnamesi.md)
- [Master Technical Specification v1.1](https://github.com/kosker-07/Book4me/blob/e34f869453d1e810907057152383e1f22efaa412/docs/BED4BOOK_MASTER_TECHNICAL_SPEC.md)
- [Arama motoru şartnamesi v1.0](https://github.com/kosker-07/Book4me/blob/e34f869453d1e810907057152383e1f22efaa412/docs/Cloude_Book4me_Arama_Motoru_Teknik_Sartname.md)
- [Rebooking ve RateRelay gereksinimleri](https://github.com/kosker-07/Book4me/blob/e34f869453d1e810907057152383e1f22efaa412/docs/BED4BOOK_Rebooking_RateRelay_Teknik_Sartname.md)
- 11 Kasım 2026 pazar karşılaştırması
