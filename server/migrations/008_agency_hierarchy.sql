-- B2B2B hierarchy: legacy sub-agencies remain unassigned until explicitly linked.
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS parent_agency_id uuid REFERENCES agencies(id);
CREATE INDEX IF NOT EXISTS agencies_parent_agency_id_idx ON agencies(parent_agency_id);

CREATE OR REPLACE FUNCTION enforce_agency_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type = 'master' THEN
    IF NEW.parent_agency_id IS NOT NULL THEN
      RAISE EXCEPTION 'master agency cannot have a parent' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.type = 'sub' AND NEW.parent_agency_id IS NOT NULL THEN
    IF NEW.parent_agency_id = NEW.id OR NOT EXISTS (
      SELECT 1 FROM agencies WHERE id = NEW.parent_agency_id AND type = 'master'
    ) THEN
      RAISE EXCEPTION 'sub agency parent must be a different master agency' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS agencies_parent_check ON agencies;
CREATE TRIGGER agencies_parent_check BEFORE INSERT OR UPDATE OF type, parent_agency_id
  ON agencies FOR EACH ROW EXECUTE FUNCTION enforce_agency_parent();
