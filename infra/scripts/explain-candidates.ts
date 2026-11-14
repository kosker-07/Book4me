// J13d diagnostic: run the EXACT loadCandidates SQL with PostgreSQL planner statistics.
// Usage: DATABASE_URL=... npx tsx infra/scripts/explain-candidates.ts <agency-uuid> <YYYY-MM-DD> <YYYY-MM-DD> <rooms>
// Read-only; does not mutate data. Run against representative seeded data.
import { readFileSync } from "node:fs";
import { pool } from "../../server/db";

async function main() {
  const [agencyId, checkIn, checkOut, roomsArg] = process.argv.slice(2);
  const rooms = Number(roomsArg);
  if (!agencyId || !/^\d{4}-\d{2}-\d{2}$/.test(checkIn ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut ?? "")
      || !Number.isInteger(rooms) || rooms < 1) {
    throw new Error("Usage: explain-candidates.ts <agency-uuid> <YYYY-MM-DD> <YYYY-MM-DD> <rooms>");
  }
  const nights = (Date.parse(checkOut!) - Date.parse(checkIn!)) / 86400000;
  if (!Number.isInteger(nights) || nights < 1) throw new Error("Invalid stay dates");
  const source = readFileSync("server/app.ts", "utf8");
  const start = source.indexOf("async function loadCandidates(");
  const end = source.indexOf("/** Nationality rules", start);
  const section = source.slice(start, end);
  const match = /db\.query\(\s*`([\s\S]*?)`\s*,\s*\[agencyId, checkIn, checkOut, rooms, nights\]/.exec(section);
  if (!match) throw new Error("loadCandidates query changed: update this diagnostic before profiling");
  const plan = await pool.query("EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT) " + match[1], [agencyId, checkIn, checkOut, rooms, nights]);
  console.log(plan.rows.map((r: { "QUERY PLAN": string }) => r["QUERY PLAN"]).join("\n"));
}
main().then(() => pool.end()).catch(async e => {
  console.error(e);
  await pool.end();
  process.exitCode = 1;
});
