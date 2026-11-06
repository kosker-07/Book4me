# bed4book — v41 (temiz yapı)

B2B rezervasyon platformu: otel, transfer, uçak (yalnızca API) ve tur; DMC panelleri ve Back Office tek çatı altında.
Çevrimdışı tarayıcı modeli: tek HTML dosyası, tüm veri tek veri katmanı arayüzünden geçer (sunucuya geçişte yalnızca adaptör değişir).

## Yapı

```
src/core      util, i18n (gettext: Türkçe kaynak metin = anahtar), store (tek veri arayüzü + kiracı kapsamı), app (olay, işlem kaydı, şifre özeti)
src/lang      tr (çoğullar), en, ar, ru — dil dosyaları (tools/i18n-build.js üretir)
src/data      konum listesi (TR + Mısır), örnek Excel verisi
src/domain    parties, auth, tenants (lisans, marka, alan adı, destek modu), pricing, product, search, booking,
              accounting (ön ödeme, API komisyonu), ops (rehber), reports, integrations, agents, jobs (gece işleri), seed
src/readers   xlsx (kendi okuyucumuz + formül), xlparse, pdfx (pdf.js 3.11.174), ocr (tesseract.js 5.1.1), impx
src/ui        dom (olay yetkilendirme, sayfa içi diyaloglar), brand, shell, v-* ekranlar, main
tools/        build.js (→ dist/index.html), load.js (Node test yükleyici), i18n-scan / i18n-build, tr/*.txt çeviri partileri
tests/        unit.js (30 kabul testi), ui-flow.js (uçtan uca tarayıcı akışı), ui-smoke.js (tüm rol × sekme), i18n-leftover.js
```

## Komutlar

```
node tools/build.js          # dist/index.html
node tests/unit.js           # iş kuralları, okuyucular, kiracılık, ticari model, agent, API Out, dil
node tests/ui-flow.js        # gerçek tıklama ile giriş → arama → rezervasyon → ödeme, lisans, dil, içe aktarma, agent
node tests/u004-sade.js     # Yama 2a: menü, düzen, arama, rezervasyon ekranı, tarihler, tıklama, Yama 1 eksikleri
node tests/u005-mudahale.js # Yama 2b: müdahale yetkisi ve muhasebe etkisi, 2b'ye kalan Yama 1 maddeleri
node tests/u005-ciftekran.js # Yama 2b: adresler, yeni sekmede oturum, sekmeler arası eşitleme
node tests/u006-crystal.js   # u006: Crystal tipi Excel, eski biçimin korunması, erken rezervasyon SPO'ları
node tests/u007-pazar.js     # u007: pazar tanımı ve milliyete göre satış kısıtı (arama, API, H2H)
node tests/u007c-tema.js     # koyu mod
LANG2=en node tests/ui-smoke.js   # her rol ve sekme, konsol hatası taraması
node tests/i18n-leftover.js en    # EN/AR/RU ekranlarında Türkçe kalıntı taraması
```

Yeni metin eklendiğinde: `node tools/i18n-scan.js` → eksikleri `tools/todo.json` sonuna ekle → `tools/tr/bN.txt` (`no|en|ar|ru`) → `node tools/i18n-build.js`.

## Ticari model (kod: pricing.js, accounting.js)
- Platform ürünlerinde DMC'lere varsayılan %5 markup (DMC × hizmet bazında değiştirilebilir).
- DMC'nin kendi API ticaretinde alış %1 + satış %1 komisyon, API ücreti yok; ay sonu tek komisyon faturası, platform alacağından veya ön ödemeden mahsup.
- Tek muhatap DMC. Kredi yok; süresinde ödenmeyen rezervasyon otomatik iptal. Ön ödeme bloke edilir, gece işiyle düşülür.

## Demo
Tüm demo hesaplarının şifresi `bed4book`. Markalı giriş: sayfa adresine `#akdeniz`, Back Office: `#backoffice`.

## Açık sorular (koddaki yer tutucular)
Şirket unvanı / vergi no (Kurallar → Şirket bilgileri), paket–modül eşlemesi (Müşteriler ve lisanslar → Paketler).

## Güncellemeler (eklentiler)
Ana koda dokunulmaz; her değişiklik `src/updates/uNNN-*.js` olarak eklenir ve derleyici sırayla yükler. Dosyayı kaldırmak güncellemeyi geri alır.

| No | Tarih | Değişiklik | Test |
|---|---|---|---|
| u001 (u001-platform-logo-ui.js) | 03.11.2026 | Back Office → Platform markası: logo yükleme alanı. Yeni logo eskisinin yerine geçer, eski logo silinir; üst bant, giriş ekranı ve platform belgelerinde görünür. | tests/u001-logo.js |
| u002 · Yama 1 (u002a…u002j) | 03.11.2026 | **a** .xls ve .csv fiyat listesi okuma · **b** çekirdek: yeni departmanlar (Product / Otel Kontrat, Commercial), kullanıcı bazlı yeni yetkiler (stop ve SPO ayrı), veri taşıma, parametreler, bildirimler · **c** otel kontratları, Legal (özel şart, sürüm), gizlilikli fiyat analizi, H2H · **d** giderler (Tekdüzen 622/760/770/780), maaş ve işveren maliyeti, maaş talepleri, otomatik prim, tanıtım faturaları, bütçe, finans raporu, alacak yaşlandırma · **e** rebooking: ters açık artırma, tutma hakkı, cezai şart, teminat ve risk grupları, otomatik fiyat takibi · **f** örnek veriler · **g–j** arayüz: menüler, bildirim zili, v40 düzeni (Transfer/Tur/Uçak Operasyon altında, Kâr özeti, Kazancınız, Üst tedarikçi kâr payı), yeni ekranlar, dashboard detayları | tests/u002-yama1.js |
| u003 (u003-dashboard-click-ui.js) | 03.11.2026 | Dashboard tıklanabilir: her KPI kartı, hizmet / kanal / DMC / hesap kırılım satırı ve trend çubuğu tıklanınca o rakamı oluşturan kayıtların listesi açılır (seçili dönemle); listeden rezervasyon detayına, cariye, onaya gidilir; CSV kopyalama; klavye ile de çalışır. | tests/u003-dashboard.js |
| u004 · Yama 2a (u004-base, u004a…u004g) | 03.11.2026 | **Sadeleştirme:** tam ekran (1040 px sınırı kalktı), solda daraltılabilir menü, telefonda çekmece ve kart görünümü, geniş ekranda üç panel · Back Office 21 sekme → 7 başlık, DMC 41 alt sekme → 30 giriş (ekranlar silinmedi) · üst bantta tek arama kutusu · tek rezervasyon ekranı (değişiklik aynı ekranda) · her listede oluşturma ve seyahat tarihi, filtre ve sıralama · tek tık özet / çift tık ayrıntı · Benim işlerim · hatırlanan filtreler ve sütunlar · dashboard'da oluşturma/seyahat tarihi · Yama 1'den 17 eksik madde | tests/u004-sade.js |
| u005 · Yama 2b (u005a…u005e) | 03.11.2026 | **Rezervasyona müdahale** (mud, mudf, mudt: üstlenme, düzeltme, fiyat ve ceza, tedarikçi değiştirme; gerekçe, işlem kaydı, cari fark, bildirim) · **çift ekran** (kayıt adresleri, yeni sekmede aynı oturum 8 saat, sekmeler arası eşitleme, eski veriyle yazma reddi) · diğer listelerde tek/çift tık ve sütun seçimi · kayıtlı raporlarım · Yama 1'den 4 madde (gelen H2H → API, H2H test konsolu, tanıtım anlaşması, otomatik rebooking puanı) | tests/u005-mudahale.js, tests/u005-ciftekran.js |
| u006 (u006a-xls-crystal.js, u006b-import-ui.js) | 03.11.2026 | Yeni Excel fiyat listesi biçimi (Crystal tipi: oda adı ayrı başlık satırında, fiyatlar altında). Biçim sayfa sayfa tanınır, eski biçimler aynen okunur. Erken rezervasyon sayfası SPO olarak, pazar tanımı ve ekonomi oda sayfaları not olarak aktarılır; tüm biçimlerde şüpheli düşük fiyat uyarısı verilir. | tests/u006-crystal.js (fixtures/crystal-s27-europe-uk.xlsx) |
| u007 (u007a-market.js, u007b-market-ui.js) | 04.11.2026 | **Pazar kısıtı kontrat (sezon) bazında:** fiyat listesinin pazarı başlıktan ("PRICE FOR EUROPE & UK") ve "Ülke-Pazar Tanımları" sayfasından okunur; kontrat yalnızca o pazardaki milliyetlere satılır (arama, fiyat, değişiklik, rebooking, API ve H2H). Milliyetsiz API sorgusunda kısıtlı kontratlar dönmez. Aynı otelin farklı pazar listeleri ayrı kontrat olur. DMC pazarı elle daraltabilir / tüm pazarlara açabilir. Milliyet listesi 80 ülkeye genişledi. | tests/u007-pazar.js |
| u007c (u007c-theme-ui.js) | 04.11.2026 | **Koyu mod:** üst banttaki düğmeyle Otomatik (cihaz ayarı) → Koyu → Açık; seçim kullanıcı bazında saklanır, giriş ekranında son seçim kullanılır. | tests/u007c-tema.js |
| u008 (u008-bed4book-brand-ui.js) | 06.11.2026 | **Yeni marka: bed4book** (bed4book.com · hotel wholesale platform). Sistem adı her yerde bed4book oldu (ekranlar, 4 dil, belgeler, sözleşme metinleri, e-posta göndericisi, alan adı bed4book.com, firma adresleri firma.bed4book.com). Yeni logo marka dosyasından şeffaf olarak çıkarıldı; açık temada koyu, koyu temada beyaz yazılı sürüm; sekme simgesi kırmızı 4. Platform renkleri logoya uyduruldu (kırmızı vurgu, koyu temada siyah zemin). Demo e-postaları @bed4book.com, demo şifresi `bed4book`; tarayıcı veri anahtarı değişti (eski demo verisi yeniden oluşur). Platform markası'ndan yüklenen logo yine önceliklidir. | tests/u007c-tema.js |

### Yama 1 notları
- Varsayılanlar Back Office → Muhasebe → Parametreler'den değişir: SGK işveren %21,75, işsizlik işveren %2, rebooking cezai şartı %10, fiyat takibi eşiği %2 ve 10 EUR, risk grubu A ≥ 80, B ≥ 50, yeni DMC puanı 65.
- Mali müşavirle doğrulanacaklar: SGK işveren oranı (%21,75 / %22,75), turizm payı oranı ve matrahı, tanıtım faturasının KDV ve mahsup kaydı.
- Rebooking artırması ve H2H canlı rezervasyonu çevrimdışı tek dosyada aynı tarayıcıda çalışır; firmalar arası canlı kullanım sunucuya geçişte açılır.
- Sıralama her zaman en iyi fiyata göredir; tanıtım faturaları sıralamayı etkilemez.

### Yama 2 notları
- Testlerin bir kısmı dış dosya ister: tests/unit.js'teki 5 okuyucu testi devir paketindeki `ornek-veriler` klasörünü, tests/u001-logo.js iki PNG'yi (`/tmp/logo1.png`, `/tmp/logo2.png`) bekler.
- Oturum yalnızca kayıt/ekran adresiyle açılan sayfada sürer (yeni sekme, yenileme); yalın adres her zaman giriş ekranını açar. Çıkış tüm sekmeleri kapatır, oturum 8 saatte düşer.
- claude.ai'de yayınlanan sayfa çerçeve içinde açıldığı için "Yeni pencerede aç" ayrı veriyle açılır (tarayıcı depolama ayrımı); bu durumda adres panoya kopyalanır. Çift ekran dosya doğrudan açıldığında tam çalışır; farklı bilgisayarlar arası eşitleme sunucu gerektirir.
- Müdahale yetkileri (mud, mudf, mudt) departman şablonlarına girmez; yönetici kullanıcı bazında verir.
- Rebooking puanı Parametreler'deki ağırlıklarla her gece otomatik hesaplanır (rbAuto = 0 ile elle moda döner).
- API'de milliyet `nationality` (ISO kodu, ör. DE, ya da ülke adı) alanıyla gönderilir; gönderilmezse pazarı kısıtlı kontratlar sonuçta yer almaz ve yanıtta `warning: nationality_missing` döner.
