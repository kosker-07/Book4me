#!/usr/bin/env bash
# Backup → restore drill (Technical Specification §7, §8 acceptance criterion 5).
# Dumps SOURCE_URL with pg_dump (custom format), restores it into a NEW empty database RESTORE_DB on the
# same server, then compares row counts of every public table and checksums of the critical tables.
# Exit code 0 only when the restored copy is identical.
#   SOURCE_URL=postgres://user:pass@host:5432/bed4book ADMIN_URL=postgres://user:pass@host:5432/postgres \
#   RESTORE_DB=bed4book_restore_drill infra/scripts/backup-restore-drill.sh
set -euo pipefail
: "${SOURCE_URL:?SOURCE_URL is required}" "${ADMIN_URL:?ADMIN_URL is required}" "${RESTORE_DB:?RESTORE_DB is required}"
[[ "$RESTORE_DB" =~ ^[a-z0-9_]+$ ]] || { echo "RESTORE_DB must be [a-z0-9_]+"; exit 2; }
DUMP="$(mktemp -d)/bed4book.dump"
# Same server as ADMIN_URL, database name replaced (query string such as ?host=... is preserved).
ADMIN_BASE="${ADMIN_URL%%\?*}"; ADMIN_QUERY=""; [[ "$ADMIN_URL" == *\?* ]] && ADMIN_QUERY="?${ADMIN_URL#*\?}"
RESTORE_URL="${ADMIN_BASE%/*}/${RESTORE_DB}${ADMIN_QUERY}"

echo "pg_dump: $(pg_dump --version)"
pg_dump --format=custom --no-owner --file="$DUMP" "$SOURCE_URL"
echo "dump written: $(du -h "$DUMP" | cut -f1) sha256=$(sha256sum "$DUMP" | cut -d' ' -f1)"

psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -qc "DROP DATABASE IF EXISTS ${RESTORE_DB}" -c "CREATE DATABASE ${RESTORE_DB}"
pg_restore --no-owner --exit-on-error --dbname="$RESTORE_URL" "$DUMP"

fingerprint() {
  psql "$1" -v ON_ERROR_STOP=1 -At <<'SQL'
SELECT string_agg(t || '=' || n, ' ' ORDER BY t) FROM (
  SELECT table_name AS t,
         (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text AS n
    FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') x;
SELECT 'bookings:' || md5(coalesce(string_agg(id::text || status || total::text, ',' ORDER BY id), '')) FROM bookings;
SELECT 'inventory:' || md5(coalesce(string_agg(id::text || allotment || '/' || reserved || '/' || price::text, ',' ORDER BY id), '')) FROM inventory_daily;
SELECT 'nights:' || md5(coalesce(string_agg(booking_id::text || stay_date || sell_price::text, ',' ORDER BY booking_id, stay_date), '')) FROM booking_nights;
SELECT 'users:' || md5(coalesce(string_agg(id::text || email || role || coalesce(agency_id::text, '-'), ',' ORDER BY id), '')) FROM users;
SELECT 'booking_no_seq:' || last_value FROM booking_no_seq;
SQL
}
# Self-test hook: DRILL_TAMPER_SQL is executed on the restored copy to prove the comparison detects differences.
if [[ -n "${DRILL_TAMPER_SQL:-}" ]]; then psql "$RESTORE_URL" -v ON_ERROR_STOP=1 -qc "$DRILL_TAMPER_SQL"; fi
SRC="$(fingerprint "$SOURCE_URL")"; DST="$(fingerprint "$RESTORE_URL")"
echo "source : $SRC" | tr '\n' ' '; echo
echo "restore: $DST" | tr '\n' ' '; echo
if [[ "$SRC" == "$DST" ]]; then echo "RESTORE DRILL PASSED"; else echo "RESTORE DRILL FAILED: restored copy differs"; exit 1; fi
