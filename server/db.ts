import { Pool, PoolClient } from "pg";

// Budget against the Railway PostgreSQL server's max_connections across ALL app replicas.
const poolMax = Number(process.env.PGPOOL_MAX ?? 20);
if (!Number.isInteger(poolMax) || poolMax < 1) throw new Error("PGPOOL_MAX must be a positive integer");
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: poolMax,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined
});

export async function withTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
  agencyId?: string | null
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (agencyId) await client.query("SELECT set_config('app.agency_id', $1, true)", [agencyId]);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
