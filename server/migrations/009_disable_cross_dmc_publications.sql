-- Disable legacy cross-DMC publications; do not fabricate agency parents.
WITH invalid AS (
  SELECT s.id, s.agency_id
    FROM agency_hotel_sales s
    JOIN agencies a ON a.id = s.agency_id
    JOIN hotels h ON h.id = s.hotel_id
   WHERE s.active = true
     AND (a.parent_agency_id IS NULL OR a.parent_agency_id <> h.owner_agency_id)
), disabled AS (
  UPDATE agency_hotel_sales s SET active = false
   FROM invalid i WHERE s.id = i.id
   RETURNING s.id, s.agency_id
)
INSERT INTO audit_logs(actor_id, agency_id, action, entity_type, entity_id)
SELECT admin.id, d.agency_id, 'publication.hierarchy_disabled', 'agency_hotel_sale', d.id::text
  FROM disabled d
  CROSS JOIN LATERAL (
    SELECT id FROM users WHERE role = 'system_admin' ORDER BY id LIMIT 1
  ) admin;
