-- DMC credit limit per sub-agency. NULL means no limit configured.
-- A booking that would push a sub-agency's open exposure (pending + approved, in EUR) over its limit is created
-- as 'awaiting_credit_approval': it holds NO stock until the parent DMC approves it.
ALTER TABLE agencies
  ADD COLUMN IF NOT EXISTS credit_limit_eur numeric CHECK (credit_limit_eur IS NULL OR credit_limit_eur >= 0);

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('draft', 'awaiting_credit_approval', 'pending', 'approved', 'rejected', 'cancelled'));
