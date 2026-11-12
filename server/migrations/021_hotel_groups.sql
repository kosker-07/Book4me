-- Same hotel loaded by several DMCs (no central catalog): records group automatically by a normalized key of
-- name + city, and rooms by their normalized name. In search, offers of the same group, room, board and terms
-- compete and only the cheapest is shown. Nobody is asked; the key is derived.
CREATE OR REPLACE FUNCTION b4b_norm(v text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(
           regexp_replace(
             lower(translate(coalesce(v, ''), 'ÇĞİIÖŞÜÂÎÛçğıöşüâîûÉÈÊéèêÁÀáàÓÒóòÚÙúùÑñ', 'CGIIOSUAIUcgiosuaiueeeeeeaaaaoooouuuunn')),
             '[^a-z0-9]+', ' ', 'g'),
           '(^| )(the|hotel|hotels|otel|oteli)( |$)', ' ', 'g'))
$$;

CREATE OR REPLACE FUNCTION hotel_group_key(name text, location text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(public.b4b_norm(name), ' +', ' ', 'g') || '|' || coalesce(split_part(public.b4b_norm(location), ' ', 1), '')
$$;

ALTER TABLE hotels ADD COLUMN IF NOT EXISTS group_key text GENERATED ALWAYS AS (public.hotel_group_key(name, location)) STORED;
CREATE INDEX IF NOT EXISTS hotels_group_key_idx ON hotels(group_key);
