-- 003: draft bookings, session revocation, login throttling, voucher log.
-- Backward compatible; 001 and 002 are not modified. Safe to re-run.
BEGIN;

-- 1. "Taslak" (draft) status. A draft does not consume inventory.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'bookings'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%pending%'
  LOOP
    EXECUTE format('ALTER TABLE bookings DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'cancelled'));

-- Quoted values a draft must be re-checked against when it is submitted.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS quoted_total numeric(14,2);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

-- 2. Session revocation (logout, password change, deactivation).
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;

-- 3. Login throttling and audit of login attempts (also for unknown e-mails).
CREATE TABLE IF NOT EXISTS login_attempts (
  id bigserial PRIMARY KEY,
  email_lower text NOT NULL,
  ip text NOT NULL,
  success boolean NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_attempts_email_idx ON login_attempts(email_lower, at DESC);
CREATE INDEX IF NOT EXISTS login_attempts_ip_idx ON login_attempts(ip, at DESC);

-- 4. Voucher generation log (PDF is generated on demand; its hash is recorded).
CREATE TABLE IF NOT EXISTS vouchers (
  id bigserial PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  sha256 text NOT NULL,
  generated_by uuid NOT NULL REFERENCES users(id),
  generated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vouchers_booking_idx ON vouchers(booking_id, generated_at DESC);

COMMIT;
