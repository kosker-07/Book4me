import { Pool, PoolClient } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX || 10),
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
