# BED4BOOK — Excel/PDF Kontrat İçe Aktarma, Agent Doğrulama ve Satışa Yayınlama Şartnamesi
Sürüm: 1.0 | Tarih: 2026-11-08 | Faz: 1 | Durum: Uygulama bekliyor
Kural ID: B4B-CONTRACT-APPROVAL-001

## Amaç ve kapsam
Mevcut PDF/Excel/OCR okuyucusu korunacak; yeniden yazılmayacak. Otel Kontratı Yükleme ekranına mevcut okuyucu bağlanacak. XLS/XLSX/PDF dosyalarından otel, oda, pansiyon, sezon, net fiyat, para birimi, kişi/çocuk kombinasyonu, SPO, stop-sale, LOS, allotment ve milliyet/pazar kuralları okunup kaynak hücre/sayfa izleriyle **taslak** kaydedilecek. Çok otelli/çok sayfalı dosyalarda her kayıt doğru otele bağlanacak. Belirsiz değerler tahmin edilmeyecek.

## Değişmez iş kuralları
1. Dosya yükleme, ayrıştırma ve veritabanına taslak kayıt **satışa açmaz**. Yeni kontrat başlangıç durumu `PENDING_VALIDATION`, `sales_enabled=false`.
2. Agent, kaynaktaki **her zorunlu alanı** normalize edilmiş kayıtla bağımsız karşılaştırır; fiyat, tarih, para birimi, oda/occupancy, SPO, stop-sale, allotment ve pazar kısıtlarını kapsar. Okunamayan veya eşleşmeyen tek zorunlu değer dahi otomatik onayı engeller.
3. Kaynak fiyat karşılaştırması kontratın **orijinal para birimi ve fiyat bazında** (kişi başı/gecelik/oda başı vb.) yapılır; FX dönüşümü veya acente markup'ı eşitlik testi değildir. Yuvarlama ancak açıkça belgelenmiş minor-unit kuralıyla yapılır. Satır/oda/tarih bazında sayım ve toplam kontrolü de yapılır.
4. Tam ve doğrulanabilir eşleşme → `APPROVED`; fark/eksik/şüphe → `REVIEW_REQUIRED` ve Back Office incelemesi. Agent kendi ürettiği yorumu kaynak kanıtı sayamaz. Manuel onay yetkili rol tarafından gerekçeli ve izlenebilir yapılır.
5. `APPROVED` olmak tek başına satış garantisi değildir. Yayın için geçerli satış/konaklama tarihleri, ilgili oda bazında manuel atanmış pozitif kontenjan, stop-sale/LOS, milliyet uygunluğu, acenteye yayın izni ve fiyat geçerliliği ayrı ayrı sağlanmalıdır. Onaylı kontrat, koşullar sağlandığında otomatik yayınlanabilir.
6. `PENDING_VALIDATION`, `REVIEW_REQUIRED`, `REJECTED` ve `DRAFT` fiyatları arama/quote/rezervasyon sonuçlarına **asla** dahil edilmez. Backend kontrolü zorunludur; yalnızca UI etiketi yeterli değildir.
7. Onay sonrası fiyat/SPO/kontenjan/satış kuralı değişikliği ilgili değişen kapsamı yeniden doğrulamaya alır; önceki onay değiştirilmiş veriyi kapsamaz. Eski onaylı sürüm ancak değişmeden kalmışsa ve ticari kurallar izin veriyorsa hizmette kalabilir; aksi halde satış engellenir.
8. Fiziksel kapasite veya ortak havuz otomatik tahmin edilmez; kontenjan kontrattan **oda/rate-plan bazında manuel** tanımlanır, paylaşımlı havuz yoktur. Gerçek rezervasyonda stok düşümü atomiktir.
9. Kaynak dosya, checksum, import batch, otel/kontrat eşleşmesi, sheet/page, cell/range, ham değer, normalize değer, doğrulama sonucu, agent sürümü, aktör, zaman ve onay gerekçesi audit trail'de saklanır. Aynı dosyanın tekrar yüklenmesi mükerrer canlı kayıt oluşturmaz.
10. Kullanıcıya önce **Agent Kontrolünde** gösterilir; sadece uygun yayın sonrası **Aktif** gösterilir. Onay/review raporu, fark listesi ve satır-hücre kanıtı görünür.
11. Geçmiş tarihli kontratlar (örn. S23/2023) tarihleri değiştirilmeden arşiv/testte tutulur; güncel satışa otomatik açılmaz. S27/2027 de ancak tarih ve diğer koşullar uygunsa yayınlanır.
12. Test/production ayrımı korunur; testteki gerçek fiyatlar canlı satışa ve gerçek müşterilere sunulmaz. Mevcut okuyucu, API, eski migration 001–003 ve mevcut testler bozulmaz.

## Önerilen durum makinesi
`DRAFT → PENDING_VALIDATION → APPROVED | REVIEW_REQUIRED`
`REVIEW_REQUIRED → PENDING_VALIDATION` (düzeltme ve tekrar kontrol) veya yetkili manuel `APPROVED` / `REJECTED`.
`APPROVED → PUBLISHED` yalnızca yayın kapıları geçilirse; `PUBLISHED → SUSPENDED` kural ihlali, değişiklik veya yetkili müdahale ile.
Yayın durumu ve doğrulama durumu ayrı alanlar olarak modellenmeli; atomik publish işlemi aynı kontrat sürümünü ve onay hash'ini doğrulamalı (TOCTOU önlemi).

## Kabul ve regresyon testleri
- T01: Dosya yüklenir → satış kapalı, arama/quote/booking görünmez.
- T02: Tüm kaynak alanları birebir eşleşir → agent onayı; yayın kapıları geçerse satış açılır.
- T03: Tek bir fiyat, tarih, para birimi veya oda uyuşmazlığı → REVIEW_REQUIRED; satış kapalı.
- T04: Boş/okunamayan formül, merged cell, sayı biçimi veya OCR düşük güveni → manuel inceleme.
- T05: Çok otelli 16 sayfalı dosya → sayfa/otel eşlemesi ve fiyatlar karışmaz.
- T06: SPO, stop-sale, LOS, allotment ve milliyet kuralı farkları → otomatik onay reddi.
- T07: Tekrar yükleme → idempotent, mükerrer otel/kontrat/fiyat yok.
- T08: Onay sonrası fiyat veya kontenjan değişikliği → değişen sürüm yeniden doğrulanır, doğrulanmamış veri satışta kullanılmaz.
- T09: Stok sıfır, stop-sale, uygunsuz milliyet, geçersiz tarih veya yayın izni yok → onaylı olsa bile satılamaz.
- T10: İki eşzamanlı rezervasyon → atomik stok, oversell yok; iptal stok iadesi bir kez.
- T11: Back Office manuel onayı rol, gerekçe, tarih, kaynak ve audit ile izlenir.
- T12: 2023 geçmiş kontratı satışa açılmaz; 2027 kontratı doğru sezonla değerlendirilir.
- T13: PDF/OCR, XLS ve XLSX aynı doğrulama kapısından geçer; okuyucunun mevcut davranışı korunur.
- T14: Hatalı çocuk fiyatı/ondalık ayırıcı ve kaynakta belirsiz `52.311` gibi hücreler otomatik düzeltilmez, incelemeye düşer.
- T15: Kaynak fiyatı ile markup'lı acente fiyatı birbirine karıştırılmaz; quote/booking/proforma immutable snapshot kullanır.

## Referans test dosyaları
- `İSTANBUL BEACH HOTEL S23 EURO KONTRAT.xlsx` — 2023, geçmiş dönem.
- `S27 Crystal Hotels PriceList_Europe & UK.xlsx` — 2027, çok otelli/çok sayfalı.
Dosyaların bu repoda bulunduğu veya veritabanına yüklendiği varsayılmaz; test fixture olarak güvenli test ortamına ayrıca alınmalıdır.

## Uygulama notları
Bu doküman **şartnamedir**, çalışan özellik/entegrasyon/DB migration/test başarı kanıtı değildir. Kod değişikliğinden önce mevcut `src/readers/*`, `src/ui/v-product.js`, `src/domain/product.js` ve server yayın/arama yolları incelenmeli. Onay kararı server-side kalıcı olarak uygulanmalı. Eski rezervasyonlar yeniden fiyatlandırılmamalıdır.
