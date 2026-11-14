// J20: default English, then browser language; persisted profile language wins after login.
export const dictionaries = {
  en: {
    "login.eyebrow": "SECURE B2B ACCESS", "login.title": "Partner sign in",
    "login.subtitle": "BED4BOOK hotel wholesale platform", "login.email": "Email",
    "login.password": "Password", "login.submit": "Sign in",
    "top.logout": "Sign out", "top.menu": "Open menu",
    "nav.search": "Hotel search", "nav.bookings": "Bookings", "nav.account": "My account", "nav.dashboard": "Dashboard", "nav.hotels": "Hotels", "nav.markets": "Markets", "nav.agencies": "Agencies and users", "nav.currencies": "Currencies and rates", "nav.reports": "Reports", "nav.contract-import": "Upload contract",
    "top.appearance": "Appearance", "top.system": "System", "top.day": "Day", "top.night": "Night"
  },
  tr: {
    "login.eyebrow": "GÜVENLİ B2B ERİŞİM", "login.title": "İş ortağı girişi",
    "login.subtitle": "BED4BOOK otel toptan satış platformu", "login.email": "E-posta",
    "login.password": "Şifre", "login.submit": "Giriş yap",
    "top.logout": "Çıkış", "top.menu": "Menüyü aç",
    "nav.search": "Otel arama", "nav.bookings": "Rezervasyonlar", "nav.account": "Hesabım", "nav.dashboard": "Panel", "nav.hotels": "Oteller", "nav.markets": "Pazarlar", "nav.agencies": "Acenteler ve kullanıcılar", "nav.currencies": "Para birimleri ve kurlar", "nav.reports": "Raporlar", "nav.contract-import": "Sözleşme yükle",
    "top.appearance": "Görünüm", "top.system": "Sistemle Aynı", "top.day": "Gündüz", "top.night": "Gece"
  }
};
export const supportedLanguages = ["en", "tr"];
export function browserLanguage(value = navigator.language) { return /^tr(?:-|$)/i.test(value) ? "tr" : "en"; }
let language = browserLanguage();
export function setLanguage(value) { language = supportedLanguages.includes(value) ? value : browserLanguage(); document.documentElement.lang = language; return language; }
export function getLanguage() { return language; }
export function t(key) { return dictionaries[language][key] ?? dictionaries.en[key] ?? key; }
export function equalKeys() { return Object.keys(dictionaries.en).sort().join("|") === Object.keys(dictionaries.tr).sort().join("|"); }
