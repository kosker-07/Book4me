-- Finance ledger (double entry). Owner-approved structure (12 Nov 2026):
--  * Two kinds of books: the operator's book (book_owner_id NULL) where BED4BOOK settles only with DMCs, and each
--    DMC's own book (book_owner_id = DMC) where the DMC keeps its sub-agencies' accounts.
--  * Marketplace sale (seller DMC A's hotel, buyer DMC B's sub-agency):
--      operator book: B debit = net + platform margin; A credit = net; BED4BOOK revenue credit = platform margin.
--      B's book:      sub-agency debit = sale price;    B credit = sale price.
--  * DMC's own sale (A's hotel, A's sub-agency):
--      operator book: A debit = platform fee; BED4BOOK revenue credit = platform fee (only when the fee is > 0).
--      A's book:      sub-agency debit = sale price;    A credit = sale price.
--  * Posted when a booking becomes approved; a cancellation/rejection after approval posts reversing entries.
--    Bookings awaiting credit approval never post. Entries and lines can never be updated or deleted.
-- Amounts are in the booking currency, taken from the frozen per-night breakdown (booking_nights x rooms).

CREATE TABLE IF NOT EXISTS ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_owner_id uuid REFERENCES agencies(id),            -- NULL = operator (BED4BOOK) book
  booking_id uuid REFERENCES bookings(id),
  kind text NOT NULL CHECK (kind IN ('booking','reversal')),
  reverses_id uuid REFERENCES ledger_entries(id),
  currency char(3) NOT NULL,
  description text NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'reversal') = (reverses_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ledger_entries_booking_idx ON ledger_entries(booking_id);
CREATE INDEX IF NOT EXISTS ledger_entries_book_idx ON ledger_entries(book_owner_id, posted_at);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_reversed_once ON ledger_entries(reverses_id) WHERE reverses_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ledger_lines (
  id bigserial PRIMARY KEY,
  entry_id uuid NOT NULL REFERENCES ledger_entries(id),
  party_kind text NOT NULL CHECK (party_kind IN ('dmc','sub','platform_revenue')),
  party_agency_id uuid REFERENCES agencies(id),          -- NULL only for platform_revenue
  debit numeric NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric NOT NULL DEFAULT 0 CHECK (credit >= 0),
  CHECK ((debit = 0) <> (credit = 0)),
  CHECK ((party_kind = 'platform_revenue') = (party_agency_id IS NULL))
);
CREATE INDEX IF NOT EXISTS ledger_lines_entry_idx ON ledger_lines(entry_id);
CREATE INDEX IF NOT EXISTS ledger_lines_party_idx ON ledger_lines(party_agency_id);

CREATE OR REPLACE FUNCTION ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger is append-only; post a reversing entry instead';
END $$;
DROP TRIGGER IF EXISTS ledger_entries_immutable ON ledger_entries;
CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
DROP TRIGGER IF EXISTS ledger_lines_immutable ON ledger_lines;
CREATE TRIGGER ledger_lines_immutable BEFORE UPDATE OR DELETE ON ledger_lines FOR EACH ROW EXECUTE FUNCTION ledger_immutable();

-- Every entry must balance when the transaction commits.
CREATE OR REPLACE FUNCTION ledger_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d numeric; c numeric; n int;
BEGIN
  SELECT coalesce(sum(debit),0), coalesce(sum(credit),0), count(*) INTO d, c, n FROM public.ledger_lines WHERE entry_id = NEW.id;
  IF n < 2 OR d <> c THEN RAISE EXCEPTION 'ledger entry % is not balanced (debit %, credit %, lines %)', NEW.id, d, c, n; END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS ledger_entries_balanced ON ledger_entries;
CREATE CONSTRAINT TRIGGER ledger_entries_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_entry_balanced();

CREATE OR REPLACE FUNCTION ledger_post_booking(p_booking uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  b record; seller uuid; buyer_dmc uuid; cur char(3);
  sell numeric; net numeric; margin numeric; buyer_cost numeric; fee numeric; market boolean; e uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.ledger_entries WHERE booking_id = p_booking AND kind = 'booking'
             AND NOT EXISTS (SELECT 1 FROM public.ledger_entries r WHERE r.reverses_id = ledger_entries.id)) THEN RETURN; END IF;
  SELECT bk.id, bk.booking_no, bk.agency_id, bk.currency, h.owner_agency_id, a.parent_agency_id, a.type
    INTO b FROM public.bookings bk JOIN public.hotels h ON h.id = bk.hotel_id JOIN public.agencies a ON a.id = bk.agency_id WHERE bk.id = p_booking;
  seller := b.owner_agency_id; cur := b.currency;
  buyer_dmc := CASE WHEN b.type = 'sub' THEN b.parent_agency_id ELSE b.agency_id END;
  SELECT coalesce(sum(sell_price * rooms),0), coalesce(sum(net_price * rooms),0),
         coalesce(sum(marketplace_platform_margin * rooms),0), coalesce(sum(marketplace_buyer_cost * rooms),0),
         coalesce(sum(marketplace_platform_fee * rooms),0), bool_or(marketplace_buyer_cost IS NOT NULL)
    INTO sell, net, margin, buyer_cost, fee, market FROM public.booking_nights WHERE booking_id = p_booking;
  IF sell = 0 THEN RETURN; END IF;   -- nothing priced (e.g. no nights): nothing to post

  -- Operator book
  IF coalesce(market, false) THEN
    INSERT INTO public.ledger_entries(book_owner_id, booking_id, kind, currency, description)
      VALUES (NULL, p_booking, 'booking', cur, 'Marketplace sale ' || b.booking_no) RETURNING id INTO e;
    INSERT INTO public.ledger_lines(entry_id, party_kind, party_agency_id, debit, credit) VALUES
      (e, 'dmc', buyer_dmc, buyer_cost, 0), (e, 'dmc', seller, 0, net);
    IF margin > 0 THEN INSERT INTO public.ledger_lines(entry_id, party_kind, party_agency_id, debit, credit) VALUES (e, 'platform_revenue', NULL, 0, margin); END IF;
  ELSIF fee > 0 THEN
    INSERT INTO public.ledger_entries(book_owner_id, booking_id, kind, currency, description)
      VALUES (NULL, p_booking, 'booking', cur, 'Platform fee ' || b.booking_no) RETURNING id INTO e;
    INSERT INTO public.ledger_lines(entry_id, party_kind, party_agency_id, debit, credit) VALUES
      (e, 'dmc', seller, fee, 0), (e, 'platform_revenue', NULL, 0, fee);
  END IF;

  -- Buyer DMC's own book: its sub-agency owes it the sale price.
  IF b.type = 'sub' THEN
    INSERT INTO public.ledger_entries(book_owner_id, booking_id, kind, currency, description)
      VALUES (buyer_dmc, p_booking, 'booking', cur, 'Sale ' || b.booking_no) RETURNING id INTO e;
    INSERT INTO public.ledger_lines(entry_id, party_kind, party_agency_id, debit, credit) VALUES
      (e, 'sub', b.agency_id, sell, 0), (e, 'dmc', buyer_dmc, 0, sell);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION ledger_reverse_booking(p_booking uuid, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE o record; e uuid;
BEGIN
  FOR o IN SELECT * FROM public.ledger_entries x WHERE x.booking_id = p_booking AND x.kind = 'booking'
             AND NOT EXISTS (SELECT 1 FROM public.ledger_entries r WHERE r.reverses_id = x.id) ORDER BY x.posted_at, x.id LOOP
    INSERT INTO public.ledger_entries(book_owner_id, booking_id, kind, reverses_id, currency, description)
      VALUES (o.book_owner_id, o.booking_id, 'reversal', o.id, o.currency, 'Reversal (' || p_reason || '): ' || o.description) RETURNING id INTO e;
    INSERT INTO public.ledger_lines(entry_id, party_kind, party_agency_id, debit, credit)
      SELECT e, party_kind, party_agency_id, credit, debit FROM public.ledger_lines WHERE entry_id = o.id;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION bookings_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    PERFORM public.ledger_post_booking(NEW.id);
  ELSIF OLD.status = 'approved' AND NEW.status IN ('cancelled','rejected') THEN
    PERFORM public.ledger_reverse_booking(NEW.id, NEW.status);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS bookings_ledger ON bookings;
CREATE TRIGGER bookings_ledger AFTER UPDATE OF status ON bookings FOR EACH ROW EXECUTE FUNCTION bookings_ledger();
