# BED4BOOK — Yedekleme ve geri yükleme runbook'u

Teknik Şartname §7 ("Günlük otomatik yedek alınmalı; yedeklerin geri yüklenmesi düzenli test edilmelidir") ve §8 Kabul Kriteri 5 ("Yedek geri yükleme … başarılı olur") için.

## 1. Günlük yedek

Yönetilen PostgreSQL kullanılıyorsa sağlayıcının günlük otomatik yedeği ve PITR (zamana dönük geri yükleme) açık olmalıdır. Buna ek olarak sağlayıcıdan bağımsız mantıksal yedek alınır:

```bash
pg_dump --format=custom --no-owner --file="bed4book-$(date -u +%Y%m%dT%H%M%SZ).dump" "$DATABASE_URL"
sha256sum bed4book-*.dump > bed4book-dumps.sha256
```

- `pg_dump` ana sürümü sunucuyla aynı veya daha yeni olmalıdır (PostgreSQL 16).
- Yedek dosyaları şifreli, erişim kontrollü nesne depolamaya yüklenir; uygulama sunucusunda tutulmaz.
- Saklama süresi (ör. 30 gün) KVKK değerlendirmesiyle belirlenir.
- Yedek bağlantısı uygulamanın runtime rolüyle değil, yalnız okuma yetkili ayrı bir rolle yapılır.

## 2. Geri yükleme tatbikatı (en az ayda bir ve her canlıya geçiş öncesi)

`infra/scripts/backup-restore-drill.sh`:

1. Kaynak veritabanını `pg_dump` (custom format) ile yedekler.
2. Aynı sunucuda **yeni ve boş** bir veritabanı oluşturup yedeği `pg_restore` ile yükler.
3. Tüm tabloların satır sayılarını ve kritik tabloların (`bookings`, `inventory_daily`, `booking_nights`, `users`) içerik özetlerini ve `booking_no_seq` değerini karşılaştırır.
4. Fark yoksa `RESTORE DRILL PASSED` yazar ve 0 ile çıkar; fark varsa 1 ile çıkar.

```bash
SOURCE_URL="postgres://USER:PASS@HOST:5432/bed4book" \
ADMIN_URL="postgres://USER:PASS@HOST:5432/postgres" \
RESTORE_DB="bed4book_restore_drill" \
infra/scripts/backup-restore-drill.sh
```

Tatbikat **asla üretim veritabanının üzerine** geri yükleme yapmaz; her zaman ayrı bir veritabanı kullanır. Tatbikattan sonra `DROP DATABASE bed4book_restore_drill;` ile silinir.

Karşılaştırmanın farkı gerçekten yakaladığını kanıtlamak için öz-test: `DRILL_TAMPER_SQL` geri yüklenen kopyada çalıştırılır ve script'in **başarısız** olması beklenir:

```bash
DRILL_TAMPER_SQL="UPDATE bookings SET total = total + 1" … infra/scripts/backup-restore-drill.sh   # beklenen: exit 1
```

Her tatbikatın tarihi, yedek dosyasının SHA-256'sı, süre ve sonuç kayıt altına alınır.

## 3. Gerçek olay sırasında geri yükleme

1. Uygulamayı bakım moduna al (yazmaları durdur).
2. Mümkünse sağlayıcının PITR özelliğiyle olay öncesine dön; değilse son doğrulanmış mantıksal yedeği yeni bir veritabanına `pg_restore` ile yükle.
3. Yukarıdaki karşılaştırma sorgularıyla yedek ile geri yüklenen kopyayı doğrula.
4. Uygulamanın `DATABASE_URL`'ünü yeni veritabanına çevir, `/ready` uç noktasını kontrol et.
5. Kesinti aralığındaki rezervasyonları Back Office ile mutabakat et; olay raporunu yaz.

## 4. Otomasyon durumu

| Adım | Durum |
|---|---|
| Tatbikat script'i | Var; CI'de her çalıştırmada eski veri + v1 verisi içeren veritabanında koşar ve öz-testi yapılır |
| Üretimde günlük yedek | Hosting kararı bekliyor (yol haritası §13, karar 9) |
| Yedeklerin nesne depolamaya yüklenmesi | Hosting kararı bekliyor |
| Üretim ortamında tatbikat | Henüz yapılmadı (üretim ortamı yok) |
