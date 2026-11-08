// Reference data: ISO 3166-1 alpha-2 country codes and the ISO 4217 currency allow-list with minor units.
// Migration 005 seeds the same values into the countries / currencies tables
// (tests/server/rules.test.ts checks that both lists match).

export const COUNTRY_CODES: readonly string[] = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ " +
  "BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ " +
  "DE DJ DK DM DO DZ " +
  "EC EE EG EH ER ES ET " +
  "FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY " +
  "HK HM HN HR HT HU " +
  "ID IE IL IM IN IO IQ IR IS IT " +
  "JE JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ " +
  "LA LB LC LI LK LR LS LT LU LV LY " +
  "MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
  "NA NC NE NF NG NI NL NO NP NR NU NZ " +
  "OM " +
  "PA PE PF PG PH PK PL PM PN PR PS PT PW PY " +
  "QA " +
  "RE RO RS RU RW " +
  "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ " +
  "TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
  "UA UG UM US UY UZ " +
  "VA VC VE VG VI VN VU " +
  "WF WS " +
  "YE YT " +
  "ZA ZM ZW"
).split(" ");

const COUNTRY_SET = new Set(COUNTRY_CODES);
export const isCountryCode = (v: unknown): v is string => typeof v === "string" && COUNTRY_SET.has(v);

/** ISO 4217 code → minor units (number of decimal places). EUR is the internal FX reference currency. */
export const CURRENCIES: Readonly<Record<string, { name: string; minorUnits: 0 | 1 | 2 | 3 }>> = {
  EUR: { name: "Euro", minorUnits: 2 },
  USD: { name: "US Dollar", minorUnits: 2 },
  GBP: { name: "Pound Sterling", minorUnits: 2 },
  TRY: { name: "Turkish Lira", minorUnits: 2 },
  CHF: { name: "Swiss Franc", minorUnits: 2 },
  JPY: { name: "Yen", minorUnits: 0 },
  CNY: { name: "Yuan Renminbi", minorUnits: 2 },
  RUB: { name: "Russian Ruble", minorUnits: 2 },
  AED: { name: "UAE Dirham", minorUnits: 2 },
  SAR: { name: "Saudi Riyal", minorUnits: 2 },
  QAR: { name: "Qatari Rial", minorUnits: 2 },
  KWD: { name: "Kuwaiti Dinar", minorUnits: 3 },
  BHD: { name: "Bahraini Dinar", minorUnits: 3 },
  OMR: { name: "Rial Omani", minorUnits: 3 },
  JOD: { name: "Jordanian Dinar", minorUnits: 3 },
  ILS: { name: "New Israeli Sheqel", minorUnits: 2 },
  EGP: { name: "Egyptian Pound", minorUnits: 2 },
  AZN: { name: "Azerbaijan Manat", minorUnits: 2 },
  GEL: { name: "Lari", minorUnits: 2 },
  KZT: { name: "Tenge", minorUnits: 2 },
  UAH: { name: "Hryvnia", minorUnits: 2 },
  PLN: { name: "Zloty", minorUnits: 2 },
  CZK: { name: "Czech Koruna", minorUnits: 2 },
  HUF: { name: "Forint", minorUnits: 2 },
  RON: { name: "Romanian Leu", minorUnits: 2 },
  BGN: { name: "Bulgarian Lev", minorUnits: 2 },
  SEK: { name: "Swedish Krona", minorUnits: 2 },
  NOK: { name: "Norwegian Krone", minorUnits: 2 },
  DKK: { name: "Danish Krone", minorUnits: 2 },
  CAD: { name: "Canadian Dollar", minorUnits: 2 },
  AUD: { name: "Australian Dollar", minorUnits: 2 },
  INR: { name: "Indian Rupee", minorUnits: 2 }
};
