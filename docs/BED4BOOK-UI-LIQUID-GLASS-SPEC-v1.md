# BED4BOOK — UI/UX TASARIM TEKNİK ŞARTNAMESİ v1.0
Durum: Ürün sahibi tarafından onaylanan görsel standart.
Referans: 11.11.2026 tarihinde seçilen **ikinci** Liquid Glass DMC Yönetimi konsept görseli.
Kapsam: BED4BOOK web uygulamasının mevcut ve yeni bütün ekranları.
Öncelik: Görsel tasarım standardı. İş modeli, veri modeli, API, rezervasyon ve fiyat hesaplama kurallarını değiştirmez.

## 1. Değiştirilemez marka varlıkları
- Tek geçerli logo, ürün sahibinin 11.11.2026 tarihinde sağladığı orijinal **bed4book.com** görselidir; görsel üretimindeki taklit logo geçerli kaynak değildir.
- Logoda beyaz küçük harfli “bed” ve “book”, kırmızı stilize “4”, kırmızı “.com”, “hotel wholesale platform” sloganı ve özgün oranlar korunur. Logonun yeniden çizilmesi, farklı fontla yazılması, yeniden renklendirilmesi, kırpılması, esnetilmesi veya parçalarının değiştirilmesi yasaktır.
- Orijinal logo dosyası proje varlıklarına tek kanonik asset olarak konumlandırılmalı; tüm ekranlar aynı dosyayı kullanmalıdır. Asset mevcut değilse geliştirici ürün sahibinden orijinal dosyayı istemeli, geçici taklit üretmemelidir.
- Responsive ölçülerde `object-fit: contain`, doğal en-boy oranı ve yeterli çevre boşluğu kullanılır. Koyu arka planla kontrast korunur.

## 2. Onaylı görsel yön
- Onaylanan seçenek: **Konsept 2 — Liquid Glass DMC Yönetimi**.
- Ana zemin: siyah/antrasit. Vurgu: BED4BOOK kırmızısı. Metin: beyaz/açık gri.
- Sol menü, üst arama/hesap çubuğu, KPI kartları, DMC listesi, sağ detay paneli, sekmeler, filtreler, işlem butonları ve alt bilgi panelleri aynı görsel dilde olmalıdır.
- Koyu, yarı saydam cam yüzeyler; yumuşak arka plan bulanıklığı; ince açık renkli kontur; kontrollü yansıma; yuvarlatılmış köşeler; hafif kırmızı odak/aktif durum ışıması.
- Kırmızı parlama yalnızca seçili/önemli aksiyonlarda kullanılmalı; veri yoğun tablolarda aşırı glow kullanılmamalıdır.
- Görseldeki DMC isimleri, sayılar, kâr yüzdeleri ve grafik değerleri **temsili veridir**, uygulama gereksinimi veya gerçek veri değildir.

## 3. Tasarım tokenları (önerilen başlangıç, uygulama öncesi doğrulanacak)
- `--b4b-bg: #0b0d12`; `--b4b-red: #e30613`; `--b4b-text: #f6f6f8`.
- `--b4b-glass: rgba(29,31,39,.72)`; `--b4b-glass-border: rgba(255,255,255,.16)`.
- `--b4b-glass-blur: 16px`; kart yarıçapı 16–20px; buton yarıçapı 10–14px.
- Renk ve efektler tek merkezî CSS token setinden yönetilir; mevcut tokenlar mümkün olduğunca korunur.
- Blur desteği olmayan tarayıcılar için opak, okunaklı fallback sağlanır.

## 4. Bileşen davranışı
- Birincil buton: BED4BOOK kırmızı gradyanı, beyaz metin, belirgin hover/focus/disabled.
- İkincil buton ve filtre: yarı saydam cam yüzey, ince sınır, kontrollü hover.
- Aktif sol menü ve sekme: kırmızı vurgu, metin ve ikon okunaklılığı.
- Tablolar: yoğun veri için okunabilir koyu satırlar, açık başlıklar, net satır ayırıcılar; finansal rakamlar sağa hizalanabilir.
- Formlar: karanlık arka plan, açık metin, net etiket, görünür doğrulama/hata mesajları.
- Modal ve detay panelleri: cam görünümü, ancak içerik okunurluğu efektin önündedir.
- Kullanıcı yetkileri, gerçek veriler, işlem akışları ve API çağrıları görsel tasarımdan bağımsız kalır.

## 5. Responsive, erişilebilirlik ve performans
- Masaüstü, tablet ve mobil ekranlarda kullanılabilir düzen; dar ekranlarda menü açılır/kapanır, tablolar yatay kaydırılabilir veya uygun adaptif görünüm kullanır.
- Metin/zemin kontrastı WCAG AA hedefler: normal metin en az 4.5:1, büyük metin en az 3:1.
- Klavye odağı görünür, dokunma hedefleri yeterli, hover dışındaki durumlar da anlaşılır.
- `prefers-reduced-motion` ve düşük performanslı cihazlarda hareket/blur azaltılır.
- Ağır animasyonlar, sürekli GPU yükü ve gereksiz arka plan bulanıklığından kaçınılır.

## 6. Uygulama ve değişiklik kontrolü
- Kaynak arayüz: mevcut `web/index.html`, `web/styles.css`, `web/app.js`; sıfırdan hayalî bir arayüzle değiştirilmez.
- Önce ortak logo bileşeni/asset referansı ve merkezî CSS tokenları; ardından menü, buton, kart, tablo, form ve modallar aşamalı uyarlanır.
- Görsel düzenleme dışında iş mantığı, veritabanı, DMC erişim kuralları, fiyat zinciri, rezervasyon ve API değişiklikleri yapılmaz.
- Uygulama ayrı feature branch/PR üzerinden, mevcut CI ve görsel regresyon kontrolleriyle yürütülür; ürün sahibinin onayı olmadan merge/deploy yapılmaz.
- Bu dosyanın eklenmesi **yalnızca şartname kaydıdır**; mevcut arayüzde görsel değişiklik uygulandığı anlamına gelmez.

## 7. Kabul kriterleri
1. Tüm sayfalarda aynı orijinal logo, oran kaybı veya yeniden çizim olmadan görünür.
2. DMC Yönetimi ekranı onaylı ikinci konseptin görsel diliyle uyumludur.
3. Diğer ekranlarda ortak buton, menü, kart, form ve durum stilleri tutarlıdır.
4. Masaüstü/tablet/mobil, klavye, kontrast ve reduced-motion kontrolleri geçer.
5. Kullanıcı oturumları, yetkiler, fiyatlandırma, rezervasyon ve API davranışları değişmemiştir.
6. Ürün sahibi gerçek uygulama ekran görüntülerini inceleyip onaylamıştır.
