# BED4BOOK — Hotel Wholesale Platform
## Proje Şartnamesi v1.0

- **Tarih:** 7 Kasım 2026
- **Durum:** İlk ticari sürüm
- **Kaynak:** Kullanıcının sağladığı `BED4BOOK_Proje_Sartnamesi.pdf` (3 sayfa)
- **Belge niteliği:** Kaynak PDF'nin Markdown aktarımıdır. Kaynakta bulunmayan gereksinimler eklenmemiştir.

## Proje hedefi

Manuel olarak tanımlanan otel envanterinin seçili alt acentelere açıldığı, alt acentelerin web üzerinden rezervasyon oluşturabildiği ve operasyon ekibinin rezervasyonları Back Office üzerinden yöneterek voucher üretebildiği BED4BOOK B2B platformunu devreye almak.

## 1. Marka ve ürün tanımı

- Marka: **BED4BOOK**
- Web: www.bed4book.com
- Kurumsal e-posta: founder@bed4book.com
- Slogan: Hotel Wholesale Platform
- Faaliyet alanları: Travel Technology, Hotel Marketplace, Global Distribution.

Logo olarak kullanıcı tarafından sağlanan güncel BED4BOOK logosu kullanılacaktır. Görsel kimlik siyah, beyaz ve kırmızı esaslıdır; kesin renk kodları orijinal logo dosyasından alınacaktır. Kişisel isim, telefon ve kişisel unvan proje dokümanlarında ve ürün arayüzlerinde yer almayacaktır.

## 2. Projenin kapsamı

**Dahil:** responsive web sitesi/platformu, yönetici paneli, alt acente paneli, manuel otel/oda/fiyat/kontenjan yönetimi, alt acenteye ürün açma, rezervasyon akışı, Back Office, rezervasyon durum takibi, voucher üretimi, kullanıcı rolleri, veri izolasyonu, temel güvenlik ve yedekleme.

**Hariç:** Android/iOS mobil uygulaması, App Store/Google Play, tedarikçi API/XML entegrasyonları, banka API'si, sanal POS, e-fatura ve muhasebe programı entegrasyonları. Bu kalemler sonraki fazlarda ayrı planlanacaktır.

## 3. Kullanıcı yolculukları

**Yönetici:** sisteme giriş yapar → otel ve görsellerini ekler → oda/pansiyon seçeneklerini tanımlar → tarih bazlı fiyat ve kontenjan girer → oteli seçili alt acentelere satışa açar.

**Alt acente:** kendisine açılmış otelleri arar → fiyat ve koşulları inceler → misafir ve konaklama bilgilerini girer → rezervasyon talebi oluşturur → rezervasyon durumunu panelinden takip eder → onaylanan rezervasyonun voucher'ını alır.

**Operasyon:** yeni rezervasyon Back Office kuyruğuna düşer → bilgileri kontrol eder → onaylar, reddeder veya izin verilen değişikliği yapar → onayda voucher üretir → işlem geçmişini takip eder.

## 4. Teslim edilecek modüller

| Modül | Asgari teslimat |
|---|---|
| Genel web alanı | BED4BOOK marka sunumu, faaliyet alanları, iletişim ve giriş bağlantıları; mobil uyumlu sayfa yapısı. |
| Yönetim paneli | Otel, oda, pansiyon, görsel, fiyat, kontenjan, alt acente ve satışa açma yönetimi. |
| Alt acente paneli | Yetkili olduğu otelleri arama/görüntüleme, fiyat inceleme, rezervasyon oluşturma ve takip. |
| Back Office | Rezervasyon kuyruğu, detay, onay/ret/iptal durumları, işlem geçmişi ve operasyon notları. |
| Voucher | Onaylı rezervasyondan BED4BOOK markalı PDF voucher oluşturma ve indirme. |
| Kullanıcı ve güvenlik | Giriş, roller, acente bazlı veri ayrımı, parola güvenliği ve denetim kayıtları. |

## 5. Geliştirme iş bölümü

**Cloud/AI geliştirme ortamı:** teknik tasarım ve kod üretimi, dosya içerikleri, kurulum komutları, test senaryoları ve hata düzeltme önerilerini sağlar.

**Teknik uygulayıcı:** talimatlara göre dosyaları yerleştirir, komutları çalıştırır, test çıktılarını paylaşır ve sunucu kurulumunu yürütür.

**Proje sahibi:** marka, iş kuralları, ticari kararlar, dış hizmet anlaşmaları ve canlıya geçiş onaylarını verir.

Bu iş bölümü, otomatik olarak kodun hatasız olduğu anlamına gelmez. Her teslimat test edilmelidir. Canlı sunucuya geçiş ve kritik değişiklikler açık onay olmadan yapılmamalıdır.

## 6. Önerilen iş planı ve takvim

| Aşama | İş paketi | Tahmini süre |
|---|---|---|
| 1 | Mevcut ZIP/kod ve şartname incelemesi; modül envanteri, eksik ve risk listesi. | 2–4 iş günü |
| 2 | Kapsam ve veri modelinin kesinleştirilmesi; hosting uygunluk kontrolü; ortam hazırlığı. | 2–4 iş günü |
| 3 | Backend/veri tabanı ve kullanıcı-acente yetkilendirme altyapısı. | 1–2 hafta |
| 4 | Manuel otel, oda, fiyat, kontenjan ve alt acenteye satış işlevleri. | 1 hafta |
| 5 | Rezervasyon akışı, Back Office, durum yönetimi ve voucher. | 1–2 hafta |
| 6 | Uçtan uca, güvenlik, veri izolasyonu, yedekleme ve kullanıcı kabul testleri. | 1 hafta |
| 7 | Pilot kullanım, hata düzeltmeleri, DNS/SSL ve kontrollü canlıya geçiş. | 2–4 iş günü |

Planlama tahmini, kapsamın yalnızca bu ilk sürümle sınırlandırıldığı ve teknik uygulayıcının düzenli çalıştığı varsayımıyla yaklaşık **4–6 hafta** olarak hedeflenebilir. İlk kod denetiminde backend/veri tabanı gibi temel parçaların eksik olduğu görülürse süre uzar. Bu nedenle takvim, ilk inceleme sonunda güncellenmelidir; kesin teslim tarihi taahhüdü değildir.

## 7. Canlıya geçiş kapıları

Canlıya geçiş için aşağıdaki maddelerin tamamı kabul edilmelidir:

- Yönetici otel ve fiyat ekleyebiliyor; alt acente yalnızca kendisine açılan ürünü görüyor.
- Alt acente rezervasyon oluşturuyor; rezervasyon Back Office'te doğru bilgilerle görünüyor.
- Yetkili onayı sonrası voucher doğru içerikle üretiliyor.
- İki ayrı alt acente birbirinin fiyat, müşteri ve rezervasyon verisini göremiyor.
- Mükerrer rezervasyon ve kontenjan aşımı kontrolleri çalışıyor.
- Yedekleme ve geri yükleme testi başarılı.
- HTTPS, rol kontrolleri ve kritik işlem kayıtları etkin.
- Pilot kullanıcı kabul testleri tamamlanmış ve kritik hata kalmamış.

## 8. Hosting ve operasyon yaklaşımı

Mevcut hosting satın alımı, seçilen mimariyle uyumluluk kontrolünden geçirilmeden kesinleştirilmemelidir. Statik web hosting tek başına backend ve PostgreSQL gereksinimlerini karşılamayabilir. Uygulama sunucusu, veri tabanı, dosya depolama, SSL, yedekleme ve e-posta gönderimi birlikte değerlendirilmelidir.

Önceki sunucu dokümanındaki başlangıç referansı **4 vCPU, 8 GB RAM, 160 GB SSD ve Ubuntu 24.04 LTS** uygulama sunucusudur; bu değerler sağlayıcı teklifleri ve gerçek yükle doğrulanmalıdır.

## 9. Sonraki fazlar

İlk ticari sürüm istikrarlı çalıştıktan sonra tedarikçi API/XML bağlantıları, sanal POS/ödeme, banka hareketleri, e-fatura, muhasebe entegrasyonları, gelişmiş raporlama ve ölçekleme ihtiyaçları ayrı fazlar olarak planlanabilir. Her yeni entegrasyon için teknik doküman, test erişimi, ticari anlaşma ve ayrı kabul kriterleri gerekir.

## 10. Proje varsayımları ve açık konular

- İlk pilotta hedeflenen alt acente sayısı başlangıçta sınırlı tutulur; örneğin 5–10 acente ile kontrollü pilot yapılır.
- Marka görselinin son/orijinal dosyası uygulama ekibine sağlanır; renk kodları bu dosyadan çıkarılır.
- Hosting sağlayıcısı, veri merkezi konumu ve mevcut paketin teknik yeterliliği netleştirilir.
- Otel/fiyat/iptal kuralları ve rezervasyon onay sorumluları iş sahibi tarafından kesinleştirilir.
- Test için örnek oteller, odalar, fiyatlar ve test acenteleri oluşturulur.

---
**Belge sonu — BED4BOOK Proje Şartnamesi v1.0**
