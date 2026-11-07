# Claude — Book4me Teknik Mimari Bağımsız İnceleme Talimatı

**İncelenecek depo:** https://github.com/kosker-07/Book4me  
**İncelenecek belge:** [TECHNICAL_ARCHITECTURE_DATA_ROADMAP_TR.md](TECHNICAL_ARCHITECTURE_DATA_ROADMAP_TR.md)  
**Tarih:** 07.11.2026

## Görev

Bu dokümanı doğru varsayarak onaylama. GitHub deposunun güncel dalını ve ilgili kaynak dosyaları gerçekten incele; mimari önerinin mevcut kodla uyumunu, ürün kurallarının eksiksiz uygulanabilirliğini ve atlanan teknik riskleri bağımsız biçimde denetle.

Öncelikli iş kuralları:
1. Arama sırasında rezervasyon tutma, oda/stok/allotment kilidi veya geçici booking oluşturulamaz.
2. Eşdeğer ve geçerli teklifler arasından normalize edilmiş toplam fiyatı en düşük olan tek teklif kazanır.
3. Kazanan dışındaki teklifler kullanıcıya alternatif veya fallback olarak gösterilmez.
4. Booking isteğinde yalnızca kazanan teklif yeniden doğrulanır.
5. Kazanan recheck başarısızsa ikinci sıraya otomatik geçiş yapılmaz; yeni arama gerekir.
6. Tedarikçi kesin onayı ve booking referansı gelmeden rezervasyon CONFIRMED olamaz.

## İncelenecek kaynaklar

En azından aşağıdaki dosyaları ve bunların çağırdığı ilgili kodları incele:

- `README.md`
- `src/core/store.js`
- `src/core/app.js`
- `src/domain/search.js`
- `src/domain/booking.js`
- `src/domain/pricing.js`
- `src/domain/product.js`
- `src/domain/integrations.js`
- `src/domain/jobs.js`
- `src/updates/u002e-rebooking.js`
- `src/updates/u008-bed4book-core.js`
- `tests/unit.js`
- `tests/ui-flow.js`
- `tests/u008-bed4book.js`
- `tools/build.js`
- `docs/Cloude_Book4me_Arama_Motoru_Teknik_Sartname.md`
- `docs/BED4BOOK_MASTER_TECHNICAL_SPEC.md`
- Bu yol haritası belgesi

Dosya yoksa bunu açıkça yaz; varmış gibi varsayma. Gerekirse repository search ile hold, lock, reserve, allotment, booking, confirm, fallback, winner, supplier, tenant, localStorage, IndexedDB ve API anahtarlarını ara.

## Denetim soruları

### A. Mevcut durum doğruluğu
- Uygulama gerçekten browser-only / tek HTML / LocalStorage mı?
- Çalışan backend, merkezi DB, migration, gerçek API ve sunucu tarafı RBAC var mı?
- Store içindeki ServerAdapter yalnızca iskelet mi, yoksa tamamlanmış ve test edilmiş mi?
- README ve teknik belgeler arasında tarih/sürüm veya davranış çelişkisi var mı?

### B. Search ve tek kazanan
- Fiyat sıralaması gerçek normalize edilmiş toplam fiyatı mı kullanıyor?
- Oda, board, occupancy, tarih, milliyet/pazar, iptal, ödeme ve zorunlu ücret eşdeğerliği uygulanıyor mu?
- Son kullanıcıya tek kazanan mı dönüyor? Alternatif teklif veya gizli tedarikçi verisi API/UI/export/log üzerinden sızıyor mu?
- Kısmi tedarikçi yanıtları, timeout ve stale quote davranışları doğru mu?

### C. Rezervasyon doğruluğu
- Search hiçbir yerde hold/lock veya geçici booking oluşturuyor mu?
- Booking akışında yalnızca kazanan tedarikçi recheck ediliyor mu?
- Recheck fail olduğunda ikinci teklif çağrılıyor mu?
- Supplier confirmation olmadan booking Onaylı/CONFIRMED oluyor mu?
- Retry, timeout, duplicate request ve belirsiz supplier response durumları güvenli mi?

### D. Veritabanı ve çok kiracılık
- Local store ve tenant scope güvenlik sınırı olarak yanlış kullanılıyor mu?
- Önerilen PostgreSQL şeması eksik FK, unique constraint, transaction veya index içeriyor mu?
- Tenant izolasyonu API, DB, background job, webhook, export ve audit katmanlarının hepsinde nasıl uygulanmalı?
- Para, kur, tarih, cancellation deadline ve kişisel veri tipleri doğru seçilmiş mi?

### E. Rebooking ve RateRelay
- Legacy u002e ve u008 v2 çakışması gerçek mi?
- Idempotency yalnızca process memory veya local store seviyesinde mi?
- Aynı rezervasyonda eşzamanlı transfer, iptal veya çift işlem riski var mı?
- RateRelay gizliliği backend/API/export/notification/log katmanlarında kanıtlanıyor mu?

### F. Teknoloji ve kurulum
- Node.js/TypeScript + NestJS, PostgreSQL, Prisma/SQL migrations, Redis/BullMQ, Docker ve GitHub Actions önerisi bu repo için uygun mu?
- Gereksiz veya erken teknoloji seçimi var mı? Daha iyi bir alternatif varsa gerekçesiyle sun.
- Yönetilen PostgreSQL/Supabase kararı hangi güvenlik, bölge, KVKK, backup, PITR ve maliyet koşullarına bağlı?
- Kademeli geçiş planı ve rollback stratejisi yeterli mi?

## Çıktı biçimi

Türkçe, somut ve kanıta dayalı rapor üret:

1. **Genel karar:** APPROVE / APPROVE WITH CHANGES / REJECT.
2. **Kısa yönetici özeti:** En kritik 5 bulgu.
3. **Bulgu tablosu:** ID, önem (Critical/High/Medium/Low), PASS/FAIL, dosya ve satır, kanıt, etki, önerilen düzeltme.
4. **Ürün kuralı kabul matrisi:** 6 değişmez kuralın her biri için PASS/FAIL/NOT VERIFIED.
5. **Mevcut mimari haritası:** Gerçek koddan doğrulanan bileşenler; önerilen ama henüz bulunmayan bileşenleri ayrı işaretle.
6. **Veritabanı incelemesi:** Eksik tablo/ilişki/constraint/index ve örnek düzeltme.
7. **Güncellenmiş uygulama yol haritası:** Bağımlılık sırası, teslimatlar, kabul kriterleri ve riskler.
8. **Test komutları ve sonuçları:** Çalıştırabildiğin komutları aynen belirt; çalıştırmadıklarını PASS sayma.
9. **Açık ürün kararları:** Teknik ekibin kendi başına varsaymaması gereken kararlar.
10. **Sonuç:** Hangi değişiklikler yapılmadan canlıya çıkılmamalı?

## İnceleme ilkeleri

- Kodda kanıt yoksa PASS verme.
- Mock/test adapter'ı gerçek tedarikçi bağlantısı sayma.
- Browser-side tenant filtrelemesini server-side authorization sayma.
- README veya eski teknik belgeyi koddan daha güvenilir kabul etme; çelişkiyi raporla.
- Bu görevde üretim kodunu değiştirme, branch merge etme veya mevcut iş kurallarını gevşetme. Önce yalnızca bağımsız denetim raporu hazırla.
- Her iddiada mümkünse dosya yolu ve satır numarası ver.
- Özellikle rezervasyon tutma/kilitleme mekanizmasını yeniden tasarıma sokma; ürün kararı olarak kapsam dışıdır.
