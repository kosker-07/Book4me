# BED4BOOK — Faz 1 web arayüzü

Bu uygulama mevcut Express 5 + PostgreSQL 16 sunucusuna bağlanan, bağımsız Vite/vanilla JavaScript arayüzüdür. **server/**, **tests/server/**, **src/**, **tools/** ve **dist/** değiştirilmemiştir. Harici otel tedarikçisi API'si yoktur.

## Kurulum

Node.js 22+ gereklidir. Depo kökünden:

```bash
cd web
npm install
cp .env.example .env
# .env dosyasındaki VITE_API_URL değerini kendi backend adresinize ayarlayın.
npm run dev
```

Tarayıcı: http://localhost:5173

Üretim derlemesi ve önizleme:

```bash
cd web
npm run build
npm run preview
```

Testler:

```bash
cd web
npm test
npx playwright install chromium
npm run test:e2e
```

## Ortam değişkenleri

- `VITE_API_URL`: Express backend'in kök URL'si. Değer frontend kodunda sabit değildir. Boşsa same-origin kullanılır.

Backend farklı origin'de çalışıyorsa CORS yapılandırması backend tarafında gerekli olabilir. Bu teslimde backend değiştirilmedi.

## Güvenlik / sözleşme

Token yalnızca JavaScript belleğinde tutulur; sayfa yenilenince yeniden giriş gerekir. 401 UNAUTHENTICATED/SESSION_REVOKED durumunda temizlenir. Backend yetki, fiyat, stok, teklif ve rezervasyon durumlarının tek otoritesidir. Yeni rezervasyon için UUID üretilir; belirsiz ağ hatasında aynı payload ve aynı UUID ile tekrar deneme seçeneği vardır. Fiyat/quote/stok uyuşmazlığında otomatik başka teklif denenmez.

**Backend değişikliği gerektiren konu:** Bu dalın esas aldığı Claude backend'inde login, 8 saatlik doğrudan bearer token döndürür. Daha önce istenen her girişte e-posta OTP ve 72 saatlik oturum **bu API sözleşmesinde yoktur**. Backend'e dokunma yasağı nedeniyle burada eklenmedi; ayrı backend işi olarak ele alınmalıdır.

**Sınırlama:** Backend arama API'si oda bazlı yetişkin/çocuk dağılımını almadığı için çoklu oda için ayrı ayrı misafir dağılımı doğrulanamaz. Bu UI mevcut API'nin toplu yetişkin/çocuk sayısı sözleşmesini kullanır; backend kontrolü esas alınır. Pazar/milliyet satış uygunluk filtresi de backend'de henüz tamamlanmamıştır.
