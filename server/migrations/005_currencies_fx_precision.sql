-- 005: reference data, currency precision and FX history. Backward compatible, re-runnable.
-- * countries: ISO 3166-1 alpha-2 (249). currencies: ISO 4217 allow-list with minor units (generated from
--   server/reference.ts; tests check both lists match).
-- * Money columns become numeric with at most 3 decimals so that 3-decimal currencies (KWD, BHD, OMR, JOD)
--   are exact. Existing values and their text form ("100.00") are unchanged.
-- * fx_rates stays the "current rate" table read by search; every insert/update is copied to fx_rate_history,
--   whose id is what quotes and booking snapshots reference.

CREATE TABLE IF NOT EXISTS countries (
  code char(2) PRIMARY KEY CHECK (code ~ '^[A-Z]{2}$'),
  name text NOT NULL
);
INSERT INTO countries(code, name) VALUES
  ('AD', 'Andorra'),
  ('AE', 'United Arab Emirates'),
  ('AF', 'Afghanistan'),
  ('AG', 'Antigua & Barbuda'),
  ('AI', 'Anguilla'),
  ('AL', 'Albania'),
  ('AM', 'Armenia'),
  ('AO', 'Angola'),
  ('AQ', 'Antarctica'),
  ('AR', 'Argentina'),
  ('AS', 'American Samoa'),
  ('AT', 'Austria'),
  ('AU', 'Australia'),
  ('AW', 'Aruba'),
  ('AX', 'Åland Islands'),
  ('AZ', 'Azerbaijan'),
  ('BA', 'Bosnia & Herzegovina'),
  ('BB', 'Barbados'),
  ('BD', 'Bangladesh'),
  ('BE', 'Belgium'),
  ('BF', 'Burkina Faso'),
  ('BG', 'Bulgaria'),
  ('BH', 'Bahrain'),
  ('BI', 'Burundi'),
  ('BJ', 'Benin'),
  ('BL', 'St. Barthélemy'),
  ('BM', 'Bermuda'),
  ('BN', 'Brunei'),
  ('BO', 'Bolivia'),
  ('BQ', 'Caribbean Netherlands'),
  ('BR', 'Brazil'),
  ('BS', 'Bahamas'),
  ('BT', 'Bhutan'),
  ('BV', 'Bouvet Island'),
  ('BW', 'Botswana'),
  ('BY', 'Belarus'),
  ('BZ', 'Belize'),
  ('CA', 'Canada'),
  ('CC', 'Cocos (Keeling) Islands'),
  ('CD', 'Congo - Kinshasa'),
  ('CF', 'Central African Republic'),
  ('CG', 'Congo - Brazzaville'),
  ('CH', 'Switzerland'),
  ('CI', 'Côte d’Ivoire'),
  ('CK', 'Cook Islands'),
  ('CL', 'Chile'),
  ('CM', 'Cameroon'),
  ('CN', 'China'),
  ('CO', 'Colombia'),
  ('CR', 'Costa Rica'),
  ('CU', 'Cuba'),
  ('CV', 'Cape Verde'),
  ('CW', 'Curaçao'),
  ('CX', 'Christmas Island'),
  ('CY', 'Cyprus'),
  ('CZ', 'Czechia'),
  ('DE', 'Germany'),
  ('DJ', 'Djibouti'),
  ('DK', 'Denmark'),
  ('DM', 'Dominica'),
  ('DO', 'Dominican Republic'),
  ('DZ', 'Algeria'),
  ('EC', 'Ecuador'),
  ('EE', 'Estonia'),
  ('EG', 'Egypt'),
  ('EH', 'Western Sahara'),
  ('ER', 'Eritrea'),
  ('ES', 'Spain'),
  ('ET', 'Ethiopia'),
  ('FI', 'Finland'),
  ('FJ', 'Fiji'),
  ('FK', 'Falkland Islands'),
  ('FM', 'Micronesia'),
  ('FO', 'Faroe Islands'),
  ('FR', 'France'),
  ('GA', 'Gabon'),
  ('GB', 'United Kingdom'),
  ('GD', 'Grenada'),
  ('GE', 'Georgia'),
  ('GF', 'French Guiana'),
  ('GG', 'Guernsey'),
  ('GH', 'Ghana'),
  ('GI', 'Gibraltar'),
  ('GL', 'Greenland'),
  ('GM', 'Gambia'),
  ('GN', 'Guinea'),
  ('GP', 'Guadeloupe'),
  ('GQ', 'Equatorial Guinea'),
  ('GR', 'Greece'),
  ('GS', 'South Georgia & South Sandwich Islands'),
  ('GT', 'Guatemala'),
  ('GU', 'Guam'),
  ('GW', 'Guinea-Bissau'),
  ('GY', 'Guyana'),
  ('HK', 'Hong Kong SAR China'),
  ('HM', 'Heard & McDonald Islands'),
  ('HN', 'Honduras'),
  ('HR', 'Croatia'),
  ('HT', 'Haiti'),
  ('HU', 'Hungary'),
  ('ID', 'Indonesia'),
  ('IE', 'Ireland'),
  ('IL', 'Israel'),
  ('IM', 'Isle of Man'),
  ('IN', 'India'),
  ('IO', 'British Indian Ocean Territory'),
  ('IQ', 'Iraq'),
  ('IR', 'Iran'),
  ('IS', 'Iceland'),
  ('IT', 'Italy'),
  ('JE', 'Jersey'),
  ('JM', 'Jamaica'),
  ('JO', 'Jordan'),
  ('JP', 'Japan'),
  ('KE', 'Kenya'),
  ('KG', 'Kyrgyzstan'),
  ('KH', 'Cambodia'),
  ('KI', 'Kiribati'),
  ('KM', 'Comoros'),
  ('KN', 'St. Kitts & Nevis'),
  ('KP', 'North Korea'),
  ('KR', 'South Korea'),
  ('KW', 'Kuwait'),
  ('KY', 'Cayman Islands'),
  ('KZ', 'Kazakhstan'),
  ('LA', 'Laos'),
  ('LB', 'Lebanon'),
  ('LC', 'St. Lucia'),
  ('LI', 'Liechtenstein'),
  ('LK', 'Sri Lanka'),
  ('LR', 'Liberia'),
  ('LS', 'Lesotho'),
  ('LT', 'Lithuania'),
  ('LU', 'Luxembourg'),
  ('LV', 'Latvia'),
  ('LY', 'Libya'),
  ('MA', 'Morocco'),
  ('MC', 'Monaco'),
  ('MD', 'Moldova'),
  ('ME', 'Montenegro'),
  ('MF', 'St. Martin'),
  ('MG', 'Madagascar'),
  ('MH', 'Marshall Islands'),
  ('MK', 'North Macedonia'),
  ('ML', 'Mali'),
  ('MM', 'Myanmar (Burma)'),
  ('MN', 'Mongolia'),
  ('MO', 'Macao SAR China'),
  ('MP', 'Northern Mariana Islands'),
  ('MQ', 'Martinique'),
  ('MR', 'Mauritania'),
  ('MS', 'Montserrat'),
  ('MT', 'Malta'),
  ('MU', 'Mauritius'),
  ('MV', 'Maldives'),
  ('MW', 'Malawi'),
  ('MX', 'Mexico'),
  ('MY', 'Malaysia'),
  ('MZ', 'Mozambique'),
  ('NA', 'Namibia'),
  ('NC', 'New Caledonia'),
  ('NE', 'Niger'),
  ('NF', 'Norfolk Island'),
  ('NG', 'Nigeria'),
  ('NI', 'Nicaragua'),
  ('NL', 'Netherlands'),
  ('NO', 'Norway'),
  ('NP', 'Nepal'),
  ('NR', 'Nauru'),
  ('NU', 'Niue'),
  ('NZ', 'New Zealand'),
  ('OM', 'Oman'),
  ('PA', 'Panama'),
  ('PE', 'Peru'),
  ('PF', 'French Polynesia'),
  ('PG', 'Papua New Guinea'),
  ('PH', 'Philippines'),
  ('PK', 'Pakistan'),
  ('PL', 'Poland'),
  ('PM', 'St. Pierre & Miquelon'),
  ('PN', 'Pitcairn Islands'),
  ('PR', 'Puerto Rico'),
  ('PS', 'Palestinian Territories'),
  ('PT', 'Portugal'),
  ('PW', 'Palau'),
  ('PY', 'Paraguay'),
  ('QA', 'Qatar'),
  ('RE', 'Réunion'),
  ('RO', 'Romania'),
  ('RS', 'Serbia'),
  ('RU', 'Russia'),
  ('RW', 'Rwanda'),
  ('SA', 'Saudi Arabia'),
  ('SB', 'Solomon Islands'),
  ('SC', 'Seychelles'),
  ('SD', 'Sudan'),
  ('SE', 'Sweden'),
  ('SG', 'Singapore'),
  ('SH', 'St. Helena'),
  ('SI', 'Slovenia'),
  ('SJ', 'Svalbard & Jan Mayen'),
  ('SK', 'Slovakia'),
  ('SL', 'Sierra Leone'),
  ('SM', 'San Marino'),
  ('SN', 'Senegal'),
  ('SO', 'Somalia'),
  ('SR', 'Suriname'),
  ('SS', 'South Sudan'),
  ('ST', 'São Tomé & Príncipe'),
  ('SV', 'El Salvador'),
  ('SX', 'Sint Maarten'),
  ('SY', 'Syria'),
  ('SZ', 'Eswatini'),
  ('TC', 'Turks & Caicos Islands'),
  ('TD', 'Chad'),
  ('TF', 'French Southern Territories'),
  ('TG', 'Togo'),
  ('TH', 'Thailand'),
  ('TJ', 'Tajikistan'),
  ('TK', 'Tokelau'),
  ('TL', 'Timor-Leste'),
  ('TM', 'Turkmenistan'),
  ('TN', 'Tunisia'),
  ('TO', 'Tonga'),
  ('TR', 'Türkiye'),
  ('TT', 'Trinidad & Tobago'),
  ('TV', 'Tuvalu'),
  ('TW', 'Taiwan'),
  ('TZ', 'Tanzania'),
  ('UA', 'Ukraine'),
  ('UG', 'Uganda'),
  ('UM', 'U.S. Outlying Islands'),
  ('US', 'United States'),
  ('UY', 'Uruguay'),
  ('UZ', 'Uzbekistan'),
  ('VA', 'Vatican City'),
  ('VC', 'St. Vincent & Grenadines'),
  ('VE', 'Venezuela'),
  ('VG', 'British Virgin Islands'),
  ('VI', 'U.S. Virgin Islands'),
  ('VN', 'Vietnam'),
  ('VU', 'Vanuatu'),
  ('WF', 'Wallis & Futuna'),
  ('WS', 'Samoa'),
  ('YE', 'Yemen'),
  ('YT', 'Mayotte'),
  ('ZA', 'South Africa'),
  ('ZM', 'Zambia'),
  ('ZW', 'Zimbabwe')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS currencies (
  code char(3) PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
  name text NOT NULL,
  minor_units smallint NOT NULL CHECK (minor_units BETWEEN 0 AND 3),
  active boolean NOT NULL DEFAULT true
);
INSERT INTO currencies(code, name, minor_units) VALUES
  ('EUR', 'Euro', 2),
  ('USD', 'US Dollar', 2),
  ('GBP', 'Pound Sterling', 2),
  ('TRY', 'Turkish Lira', 2),
  ('CHF', 'Swiss Franc', 2),
  ('JPY', 'Yen', 0),
  ('CNY', 'Yuan Renminbi', 2),
  ('RUB', 'Russian Ruble', 2),
  ('AED', 'UAE Dirham', 2),
  ('SAR', 'Saudi Riyal', 2),
  ('QAR', 'Qatari Rial', 2),
  ('KWD', 'Kuwaiti Dinar', 3),
  ('BHD', 'Bahraini Dinar', 3),
  ('OMR', 'Rial Omani', 3),
  ('JOD', 'Jordanian Dinar', 3),
  ('ILS', 'New Israeli Sheqel', 2),
  ('EGP', 'Egyptian Pound', 2),
  ('AZN', 'Azerbaijan Manat', 2),
  ('GEL', 'Lari', 2),
  ('KZT', 'Tenge', 2),
  ('UAH', 'Hryvnia', 2),
  ('PLN', 'Zloty', 2),
  ('CZK', 'Czech Koruna', 2),
  ('HUF', 'Forint', 2),
  ('RON', 'Romanian Leu', 2),
  ('BGN', 'Bulgarian Lev', 2),
  ('SEK', 'Swedish Krona', 2),
  ('NOK', 'Norwegian Krone', 2),
  ('DKK', 'Danish Krone', 2),
  ('CAD', 'Canadian Dollar', 2),
  ('AUD', 'Australian Dollar', 2),
  ('INR', 'Indian Rupee', 2)
ON CONFLICT (code) DO NOTHING;

-- New and updated rate plans must use an allow-listed currency. NOT VALID: legacy rows are not rechecked.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rate_plans_currency_fk') THEN
    ALTER TABLE rate_plans ADD CONSTRAINT rate_plans_currency_fk FOREIGN KEY (currency) REFERENCES currencies(code) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fx_rates_currency_fk') THEN
    ALTER TABLE fx_rates ADD CONSTRAINT fx_rates_currency_fk FOREIGN KEY (currency) REFERENCES currencies(code) NOT VALID;
  END IF;
END $$;

-- Money precision: up to 3 decimals.
ALTER TABLE inventory_daily    ALTER COLUMN price TYPE numeric;
ALTER TABLE bookings           ALTER COLUMN total TYPE numeric;
ALTER TABLE bookings           ALTER COLUMN quoted_total TYPE numeric;
ALTER TABLE booking_nights     ALTER COLUMN net_price TYPE numeric;
ALTER TABLE booking_nights     ALTER COLUMN markup_value TYPE numeric;
ALTER TABLE booking_nights     ALTER COLUMN sell_price TYPE numeric;
ALTER TABLE agency_hotel_sales ALTER COLUMN markup_value TYPE numeric;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('inventory_daily', 'price'), ('bookings', 'total'), ('bookings', 'quoted_total'),
      ('booking_nights', 'net_price'), ('booking_nights', 'markup_value'), ('booking_nights', 'sell_price'),
      ('agency_hotel_sales', 'markup_value')) AS v(t, c)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.t || '_' || r.c || '_scale') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%I IS NULL OR (scale(%I) <= 3 AND %I < 1e15))',
                     r.t, r.t || '_' || r.c || '_scale', r.c, r.c, r.c);
    END IF;
  END LOOP;
END $$;

-- FX history.
CREATE TABLE IF NOT EXISTS fx_rate_history (
  id bigserial PRIMARY KEY,
  currency char(3) NOT NULL REFERENCES currencies(code),
  eur_per_unit numeric(18,8) NOT NULL CHECK (eur_per_unit > 0),
  source text NOT NULL,
  valid_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fx_rate_history_currency_idx ON fx_rate_history(currency, valid_at DESC);
ALTER TABLE fx_rates ADD COLUMN IF NOT EXISTS history_id bigint REFERENCES fx_rate_history(id);

CREATE OR REPLACE FUNCTION fx_rates_record_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.eur_per_unit = OLD.eur_per_unit AND NEW.source = OLD.source
     AND NEW.valid_at = OLD.valid_at AND OLD.history_id IS NOT NULL THEN
    NEW.history_id := OLD.history_id;   -- nothing changed: keep the same history row
    RETURN NEW;
  END IF;
  INSERT INTO fx_rate_history(currency, eur_per_unit, source, valid_at)
  VALUES (NEW.currency, NEW.eur_per_unit, NEW.source, NEW.valid_at) RETURNING id INTO NEW.history_id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS fx_rates_record_history ON fx_rates;
CREATE TRIGGER fx_rates_record_history BEFORE INSERT OR UPDATE ON fx_rates
  FOR EACH ROW EXECUTE FUNCTION fx_rates_record_history();

-- Existing rates get their first history row (the trigger fires on this no-op update).
UPDATE fx_rates SET valid_at = valid_at WHERE history_id IS NULL;
