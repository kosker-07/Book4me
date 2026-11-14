// The session lives in an HttpOnly cookie set by the server; this page never holds the token itself.
export const session = { user: null };
const errors = {
  DISTRIBUTION_RULE_EXISTS:
    "Bu satıcı, alıcı ve otel için zaten bir kural var. Mevcut kuralı düzenleyin.",
  INVALID_DISTRIBUTION_RULE: "Kural bilgileri geçersiz.",
  SELLER_MUST_BE_MASTER: "Satıcı bir DMC olmalıdır.",
  BUYER_MUST_BE_MASTER: "Alıcı bir DMC olmalıdır.",
  BUYER_MUST_DIFFER_FROM_SELLER: "Satıcı ve alıcı aynı DMC olamaz.",
  HOTEL_NOT_OWNED_BY_SELLER: "Seçilen otel satıcı DMC'ye ait değil.",
  INVALID_CREDENTIALS: "E-posta veya şifre hatalı.",
  TOO_MANY_LOGIN_ATTEMPTS:
    "Çok fazla giriş denemesi. Daha sonra tekrar deneyin.",
  NATIONALITY_REQUIRED: "Aile milliyeti gerekli.",
  VALIDATION_FAILED: "Gönderilen bilgiler geçersiz.",
  PRICE_CHANGED: "Fiyat değişti. Yeni arama yapın.",
  ALLOTMENT_UNAVAILABLE: "Kontenjan tükendi. Yeni arama yapın.",
  FX_RATE_UNAVAILABLE: "Güncel döviz kuru bulunamadı.",
  PAYMENT_CURRENCY_NOT_SUPPORTED: "Ödeme para birimi desteklenmiyor.",
  UNAUTHENTICATED: "Oturum sona erdi.",
  INVALID_CURRENT_PASSWORD: "Mevcut şifre hatalı.",
  PASSWORD_TOO_SHORT: "Şifre en az 12 karakter olmalı.",
  QUOTE_EXPIRED: "Teklif süresi doldu. Yeniden arayın.",
  QUOTE_OCCUPANCY_MISMATCH: "Misafir sayısı arama koşullarıyla eşleşmiyor.",
  QUOTE_NATIONALITY_MISMATCH:
    "Ana misafirin milliyeti aile milliyetiyle eşleşmiyor.",
  CANCEL_NOT_ALLOWED: "Bu rezervasyon iptal edilemez.",
  INVALID_STATUS_TRANSITION: "Bu durum değişikliği yapılamaz.",
  VOUCHER_REQUIRES_APPROVED_BOOKING:
    "Voucher yalnızca onaylı rezervasyonda alınabilir.",
  PRODUCT_NOT_PUBLISHED: "Bu ürün acentenize açık değil.",
  BOOKING_NOT_FOUND: "Rezervasyon bulunamadı.",
  IDEMPOTENCY_KEY_REQUIRED: "İşlem anahtarı eksik.",
  INVALID_QUOTE: "Teklif geçersiz.",
  OCCUPANCY_EXCEEDS_CAPACITY: "Oda kapasitesi aşıldı.",
  ONE_NATIONALITY_PER_FAMILY: "Aile için tek milliyet girilmelidir.",
  CONTRACT_NOT_AVAILABLE: "Kontrat artık geçerli değil.",
  NATIONALITY_NOT_ELIGIBLE: "Aile milliyeti bu kontrata uygun değil.",
  ALLOTMENT_BELOW_RESERVED: "Kontenjan mevcut rezervasyonlardan düşük olamaz.",
  INVALID_PUBLICATION: "Yayın bilgileri geçersiz.",
  INVALID_ROOM: "Oda bilgileri geçersiz.",
  INVALID_RATE_PLAN: "Fiyat planı bilgileri geçersiz.",
};
export function errText(e) {
  if (e.status === 403) return "Yetkiniz yok.";
  const detail =
    e.fields && Object.keys(e.fields).length
      ? " Alanlar: " +
        Object.entries(e.fields)
          .map(([k, v]) => k + " (" + v + ")")
          .join(", ")
      : "";
  return (
    (errors[e.code] ||
      "İşlem başarısız: " + String(e.code || "Bilinmeyen hata")) + detail
  );
}
export function resetSession() {
  session.user = null;
}
export async function api(
  url,
  { method = "GET", body, headers = {}, signal } = {},
) {
  const h = { ...headers };
  if (
    method === "POST" &&
    url === "/api/agency/bookings" &&
    !h["Idempotency-Key"]
  )
    h["Idempotency-Key"] = crypto.randomUUID();
  if (body !== undefined) h["Content-Type"] = "application/json";
  h["X-Requested-With"] = "bed4book";
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    throw Object.assign(new Error("Bağlantı hatası"), {
      code: "NETWORK_ERROR",
    });
  }
  let data;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    const err = new Error(data.error || "HTTP_" + res.status);
    err.code = data.error || "HTTP_" + res.status;
    err.status = res.status;
    err.fields = data.fields;
    for (const k of [
      "contracts",
      "inventoryDays",
      "publications",
      "bookings",
      "status",
      "reason",
      "days",
      "max",
    ])
      if (data[k] !== undefined) err[k] = data[k];
    throw err;
  }
  return data;
}
export async function signIn(email, password) {
  const data = await api("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  if (!data.user?.role)
    throw Object.assign(new Error("Eksik oturum"), { code: "INVALID_SESSION" });
  try {
    const me = await api("/api/me");
    if (me.role !== data.user.role)
      throw new Error("Rol doğrulaması başarısız");
    session.user = { ...data.user, role: me.role, agencyId: me.agencyId };
    return session.user;
  } catch (e) {
    resetSession();
    throw e;
  }
}
export async function signOut() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
  } finally {
    resetSession();
  }
}
// After a page reload: if the browser still holds a valid session cookie, pick the session up again.
export async function restoreSession() {
  try {
    const me = await api("/api/auth/session");
    if (!me.authenticated) {
      resetSession();
      return false;
    }
    session.user = { id: me.userId, role: me.role, agencyId: me.agencyId };
    return true;
  } catch {
    resetSession();
    return false;
  }
}
export async function download(url, name) {
  const res = await fetch(url, {
    headers: { "X-Requested-With": "bed4book" },
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!res.ok) {
    let data = {};
    try {
      data = await res.json();
    } catch {}
    const e = new Error(data.error || "HTTP_" + res.status);
    e.code = data.error || "HTTP_" + res.status;
    e.status = res.status;
    throw e;
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
