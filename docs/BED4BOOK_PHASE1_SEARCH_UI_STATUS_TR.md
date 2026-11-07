# BED4BOOK Faz 1 — Otel Arama UI ve Gerçek Durum Raporu
Tarih: 2026-11-08 | İnceleme türü: GitHub kaynak kodu; CI/dağıtım doğrulaması yapılmadı.

## Eklenen kaynak kodu
- `src/updates/u90-contract-ops-ui.js`: kontrat operasyon sekmeleri (genel bakış, onay, fiyat karşılaştırma, kontenjan, milliyet, FX, proforma, versiyon).
- `src/updates/u91-hotel-search-ui.js`: mevcut `VS.hotelSearch` ve `SR.hotels` motorunu koruyarak arama sonuç kartları, fiyat/oda tablosu, karşılaştırma (en çok 3 otel), sonuç içi arama, müsaitlik filtresi, sayfalama.
- `docs/BED4BOOK_CONTRACT_IMPORT_AGENT_APPROVAL_SPEC_TR.md`: Agent doğrulama ve satışa açma şartnamesi.
- `server/migrations/004_nationality_contracts_proforma.sql`: milliyet/kontrat/proforma şema taslağı; **çalıştırılmadı**.

## Bilinen eksikler — Faz 1 tamamlanma engelleri
1. Mevcut browser-local `B4M.db` arayüzü ile PostgreSQL server API entegrasyonu yapılmadı.
2. Excel/PDF/OCR kaynak hücre izli import, gerçek DB'ye idempotent staging ve agent birebir doğrulama uçtan uca uygulanmadı.
3. `PENDING_VALIDATION/REVIEW_REQUIRED/APPROVED/PUBLISHED` durumlarının server-side yetkili ve atomik yayın kapıları uygulanmadı.
4. Milliyet bazlı kontrat seçim/pricing ve signed quote payload ile booking revalidation uygulanmadı.
5. Saatlik TCMB polling, tarihli FX sürümü, manuel override, stale-rate koruması tamamlanmadı.
6. Snapshot'tan pending/approved proforma üretimi, atomik seri numarası ve PDF tamamlanmadı.
7. Günlük allotment editörü, gerçek stok API bağlantısı ve değişiklik sonrası yeniden onay bağlantısı tamamlanmadı.
8. Yeni arama UI'si halen eski `SR.hotels` kaynağından sonuç alır; **yeni sözleşme onayı backend filtresi devrede değildir**.
9. GitHub'a yazılan JS modülleri için build/CI/browser/E2E testleri bu oturumda çalıştırılmadı. Railway deploy yapılmadı.
10. Arayüz prototipleri gerçek ekran görüntüsü veya gerçek veritabanı test sonucu değildir.

## Uygulanacak kabul testleri
- H01: 0 sonuç, 1 sonuç, >10 sonuç; sayfalama, filtre, karşılaştırma.
- H02: 1–5 oda, yetişkin/çocuk yaşları, milliyet, konaklama tarihleri.
- H03: Birden çok rate plan, SPO, stop-sale, LOS, eksik FX, müsaitlik yok.
- H04: Onaysız kontratın search/quote/booking sonuçlarında hiç görünmemesi (server-side).
- H05: Onaylı kontratta atomic booking, snapshot, proforma ve iptal stok iadesi.
- H06: 2023 geçmiş kontratı satışa açılmaz; 2027 kontratı doğru tarihli test edilir.
- H07: Erişilebilirlik, klavye, mobil kırılımlar, RTL ve çoklu dil.
- H08: XLS/XLSX/PDF/OCR import ve 15 adet `B4B-CONTRACT-APPROVAL-001` regresyon testi.
- H09: Browser build ve backend testleri; migration izole PostgreSQL'de çalışır; Railway staging smoke test.
- H10: Herhangi bir eksik doğrulama → satış kapalı, varsayılan güvenli davranış.

## Faz 1 kararı
**Tamamlandı olarak işaretlenemez.** UI kodu GitHub dalına eklendi, ancak uçtan uca backend entegrasyonu, otomatik onay, DB migration, testler ve deploy bekliyor. Tamamlanma yüzdesi kanıta dayalı ölçülmediğinden verilmez.
