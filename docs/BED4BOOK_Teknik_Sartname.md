# BED4BOOK — Hotel Wholesale Platform
## Teknik Şartname v1.0

- **Tarih:** 7 Kasım 2026
- **Durum:** İlk ticari sürüm kapsamı
- **Kaynak:** Kullanıcının sağladığı `BED4BOOK_Teknik_Sartname.pdf` (3 sayfa)
- **Belge niteliği:** Kaynak PDF'nin Markdown aktarımıdır. Kaynakta bulunmayan gereksinimler eklenmemiştir.

## Belgenin amacı

BED4BOOK'un yalnızca web tarayıcısı üzerinden çalışan, manuel otel envanteri ve alt acente satışını destekleyen ilk ticari sürümünün teknik gereksinimlerini tanımlar.

## 1. Ürün ve marka kararları

Ürün adı yalnızca **BED4BOOK** olacaktır. Eski Book4me / Book4me AI adları yeni arayüzlerde, dokümanlarda ve sistem metinlerinde kullanılmayacaktır.

- Web adresi: www.bed4book.com
- Kurumsal e-posta: founder@bed4book.com
- Slogan: Hotel Wholesale Platform

Kurumsal kimlikte kullanıcının sağladığı güncel BED4BOOK logosu esas alınacaktır. Renk yaklaşımı siyah, beyaz ve kırmızıdır; nihai renk kodları logo kaynak dosyasından doğrulanmalı, tahmin edilerek sabitlenmemelidir. Kişisel ad, telefon, unvan veya kişisel iletişim bilgileri bu şartnameye ve ürün arayüzlerine eklenmeyecektir.

## 2. Kapsam ve ürün sınırları

İlk sürüm bir mobil uygulama değildir. Android/iOS uygulaması, App Store veya Google Play yayını yapılmayacaktır. Sistem masaüstü, tablet ve telefon tarayıcılarında duyarlı (responsive) çalışan bir B2B web platformu olacaktır.

İlk sürümde oteller, oda tipleri, pansiyon tipleri, fiyatlar ve kontenjanlar yetkili kullanıcılar tarafından manuel girilecek; seçilen oteller alt acentelere satışa açılacak ve rezervasyonlar platform üzerinden yönetilecektir.

Tedarikçi API/XML bağlantıları, banka API'leri, sanal POS, e-fatura ve muhasebe entegrasyonları ilk sürümün zorunlu kapsamı dışındadır; ayrı faz ve onayla ele alınacaktır.

## 3. Kullanıcı rolleri ve yetkilendirme

| Rol | Yetki özeti |
|---|---|
| Sistem yöneticisi | Platform ayarları, kullanıcı/rol yönetimi, tüm otel ve rezervasyon kayıtları üzerinde yetkili yönetim. |
| Ana acente / otel içerik yöneticisi | Otel, oda, görsel, açıklama, fiyat, kontenjan ve satış kurallarını oluşturma ve yönetme. |
| Alt acente | Kendisine açılmış otelleri ve satış fiyatlarını görme; rezervasyon oluşturma ve kendi rezervasyonlarını takip etme. |
| Operasyon / Back Office | Rezervasyon inceleme, onay/ret, değişiklik ve voucher süreçlerini rol kapsamı içinde yürütme. |

Her kullanıcı yalnızca rolü ve bağlı olduğu acente kapsamındaki verilere erişebilmelidir. Bir alt acente başka bir alt acentenin fiyatlarını, müşteri bilgilerini veya rezervasyonlarını görememelidir.

## 4. Temel fonksiyonel gereksinimler

### 4.1 Otel ve envanter yönetimi

Otel adı, konum, yıldız/kategori, açıklama, olanaklar, görseller ve iletişim/operasyon notları girilebilmelidir. Otel altında oda tipleri ve pansiyon seçenekleri tanımlanmalıdır. Fiyat ve kontenjan; tarih aralığı, oda tipi, pansiyon ve gerekli satış koşullarına göre yönetilmelidir. Kayıtlar taslak, aktif veya pasif durumunda tutulabilmelidir.

### 4.2 Alt acenteye satış

Yönetici, otel veya otel-fiyat kombinasyonunu seçili alt acentelere açabilmelidir. Alt acente yalnızca kendisine satışa açılmış ve geçerli tarih/fiyat/kontenjanı bulunan ürünleri arayıp görüntüleyebilmelidir. Satış fiyatı ve varsa acenteye özel koşullar diğer acentelerden izole edilmelidir.

### 4.3 Rezervasyon ve Back Office

Rezervasyon akışı müsaitlik/kontenjan kontrolü, misafir bilgilerinin alınması, rezervasyonun oluşturulması, operasyon kuyruğuna düşmesi, yetkili onayı veya reddi ve voucher üretimini kapsamalıdır.

Rezervasyon durumları en azından **Taslak, Beklemede, Onaylandı, Reddedildi ve İptal edildi** olarak izlenmelidir. Durum değişiklikleri kullanıcı, tarih ve işlem bilgisiyle kaydedilmelidir.

### 4.4 Voucher ve belgeler

Onaylanan rezervasyon için BED4BOOK marka kimliğiyle PDF voucher üretilebilmelidir. Voucher üzerinde rezervasyon numarası, otel, konaklama tarihleri, oda/pansiyon, misafir ve operasyon notları bulunmalıdır. Yetkili kullanıcı voucher'ı görüntüleyebilmeli ve indirebilmelidir.

## 5. Önerilen teknik mimari

| Katman | Öneri / gereksinim |
|---|---|
| Web arayüzü | Mevcut kullanılabilir ekranlar korunarak responsive web arayüzüne dönüştürülür; veri tarayıcıda kalıcı tutulmaz, sunucu API'sinden alınır. |
| Backend | Node.js ve TypeScript tabanlı API; doğrulama, iş kuralları, yetkilendirme ve rezervasyon işlemleri sunucu tarafında yürütülür. |
| Veri tabanı | PostgreSQL; kullanıcı, acente, otel, oda, fiyat, kontenjan ve rezervasyon ilişkileri tutarlı şema ve migration'larla yönetilir. |
| Dosya depolama | Otel görselleri, sözleşmeler ve voucher gibi dosyalar için erişim kontrollü nesne depolama veya eşdeğer güvenli depolama. |
| Dağıtım | Ortam değişkenleri, sürüm kontrollü kurulum, HTTPS, loglama, yedekleme ve geri yükleme prosedürü. |

Teknoloji seçimi mevcut ZIP kaynak kodunun gerçek yapısı ve test sonuçları incelendikten sonra kesinleştirilmelidir. Bu belge, doğrulanmamış bir teknoloji veya mevcut kodun hazır olduğu iddiası değildir.

## 6. Sunucu başlangıç profili

Önceki sunucu şartnamesindeki başlangıç referansı: **4 vCPU, 8 GB RAM, 160 GB SSD, Ubuntu 24.04 LTS** uygulama sunucusu; PostgreSQL 16 için yönetilen veri tabanı veya eşdeğer güvenli kurulum; başlangıçta yaklaşık 50 GB veri tabanı alanı ve günlük yedek.

Bu değerler kesin satın alma emri değildir. Gerçek yük, sağlayıcı özellikleri, veri merkezi konumu ve maliyet teklifleri doğrulanarak seçilmelidir. Eski belgede tek sunucu ile başlanıp büyüdükçe ikinci sunucu eklenmesi önerilmiştir.

Dosya depolama için başlangıçta yaklaşık **100 GB S3 uyumlu nesne depolama** referans alınabilir. E-posta gönderimi için kurumsal SMTP ve SPF/DKIM yapılandırması planlanmalıdır.

## 7. Güvenlik, gizlilik ve işletim

- Parolalar güçlü, tuzlu parola özetiyle saklanmalıdır.
- Tüm kullanıcı trafiği HTTPS üzerinden olmalıdır.
- Rol ve acente bazlı erişim kontrolü backend üzerinde uygulanmalıdır.
- Hassas işlemler denetim kayıtlarına yazılmalıdır.
- Günlük otomatik yedek alınmalı; yedeklerin geri yüklenmesi düzenli test edilmelidir.
- Kişisel veriler için KVKK ve gerekiyorsa GDPR yükümlülükleri hukuki/uzman değerlendirmesiyle belirlenmelidir.
- Üretim sırları ve API anahtarları kaynak koduna yazılmamalı, güvenli ortam değişkenlerinde tutulmalıdır.

## 8. Test ve kabul kriterleri

Canlıya geçişten önce aşağıdaki uçtan uca senaryoların başarılı olması zorunludur:

1. Yönetici manuel otel, oda, fiyat ve kontenjan ekler; seçtiği alt acente bu oteli ve doğru fiyatı görür.
2. Alt acente rezervasyon oluşturur; kayıt Back Office'e düşer; yetkili onaylar ve voucher üretilir.
3. İki ayrı alt acente ile yapılan erişim testlerinde fiyat, müşteri ve rezervasyon verileri birbirinden tamamen izole kalır.
4. Aynı anda gelen rezervasyon taleplerinde kontenjan tutarsızlığı ve mükerrer rezervasyon engellenir.
5. Yedek geri yükleme, yetkisiz erişim, hata kayıtları ve temel performans testleri başarılı olur.

Her geliştirme adımında değişen dosyalar, çalıştırılacak komutlar, beklenen çıktı ve test sonucu teslim edilmelidir. Başarısız test düzeltilmeden sonraki aşamaya geçilmemelidir.

## 9. Faz dışı işler ve değişiklik kontrolü

Tedarikçi API/XML bağlantıları (ör. Hotelbeds, Expedia, Juniper), banka/sanal POS, e-fatura, muhasebe entegrasyonları, mobil uygulama ve gelişmiş otomasyonlar sonraki fazlardır. Bunlar için ayrı kapsam, maliyet, teknik doküman ve onay gerekir.

**Bu şartname tek başına canlı sunucuda veya kaynak kodda değişiklik yapma izni vermez.**

## 10. Açık kararlar

- Hosting sağlayıcısı ve veri merkezi konumu (Türkiye/AB) seçimi.
- Mevcut hosting paketinin bu mimariyi destekleyip desteklemediğinin doğrulanması.
- Nihai logo dosyasından marka renklerinin HEX/RGB kodlarının çıkarılması.
- İlk pilot alt acentelerin ve kabul testinde kullanılacak örnek otellerin belirlenmesi.
- Rezervasyon onay ve iptal politikalarının iş sahibi tarafından kesinleştirilmesi.

---
**Belge sonu — BED4BOOK Teknik Şartname v1.0**
