-- J20: persisted user language; NULL means browser-language fallback on first sign-in.
ALTER TABLE users ADD COLUMN IF NOT EXISTS language TEXT;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_language_supported;
ALTER TABLE users ADD CONSTRAINT users_language_supported CHECK (language IS NULL OR language IN ('en', 'tr', 'ar', 'ru'));
