-- BED4BOOK email OTP; apply before enabling OTP login.
CREATE TABLE IF NOT EXISTS email_otp_challenges (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 code_digest text NOT NULL,
 expires_at timestamptz NOT NULL,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_otp_challenges_user_created_idx ON email_otp_challenges(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS email_otp_challenges_expires_idx ON email_otp_challenges(expires_at);
-- Suggested maintenance: DELETE FROM email_otp_challenges WHERE created_at < now() - interval '7 days';
