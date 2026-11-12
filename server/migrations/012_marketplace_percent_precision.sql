-- Stage 2 percentage precision; migration 011 intentionally unchanged.
ALTER TABLE marketplace_distribution_rules
  ALTER COLUMN platform_margin_percent TYPE numeric(6,3)
  USING platform_margin_percent::numeric(6,3);
ALTER TABLE agencies
  ALTER COLUMN marketplace_markup_percent TYPE numeric(6,3)
  USING marketplace_markup_percent::numeric(6,3),
  ALTER COLUMN platform_fee_percent TYPE numeric(6,3)
  USING platform_fee_percent::numeric(6,3);
