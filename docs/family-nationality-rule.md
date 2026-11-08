# BED4BOOK — Aile milliyeti iş kuralı

**Kural:** Aramada seçilen tek milliyet, rezervasyondaki tüm yetişkin ve çocuklar için geçerlidir; oda sayısı veya oda dağılımı bu kuralı değiştirmez.

- Arama API'si `nationalities: ["TR"]` biçiminde tam bir ISO 3166-1 alpha-2 ülke kodu kabul eder. Tek aile için kişi sayısı kadar milliyet istenmez.
- Kontrat uygunluğu, pazar kısıtlamaları ve fiyat değerlendirmesi bu **tek aile milliyetine** göre backend'de yapılır.
- Rezervasyondaki ana misafirin `guest.nationality` değeri aramada imzalanan aile milliyetiyle eşleşmelidir; aksi halde `QUOTE_NATIONALITY_MISMATCH` döner.
- Diğer misafirlerin milliyet alanı kontrat/fiyat kararını etkilemez. Kişi kimliği ve çocuk yaşı kontrolleri bağımsız olarak uygulanır.
- Oda bazında yetişkin/çocuk kapasitesi ayrı ve zorunlu bir kuraldır.
- Eski çoklu milliyetli arama istekleri bu yeni sözleşmeye göre uyarlanmalıdır.
- Entegrasyon testleri tek milliyetle çok kişilik ve çok odalı aramayı, sözleşme uygunluğunu ve teklif/rezervasyon eşleşmesini doğrulamalıdır.

**Güvenlik:** Milliyet/kontrat/fiyat kararı yalnızca backend tarafından verilir. UI girdileri fiyat veya uygunluğu tek başına belirleyemez.
