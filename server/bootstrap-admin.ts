import { pool } from "./db";
import { hashPassword } from "./security";

/** One-time bootstrap. The transaction-level advisory lock serializes concurrent replicas. */
export async function bootstrapAdmin(): Promise<void> {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";
  if (!email || !password) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(746812341)");
    const existing = await client.query("SELECT 1 FROM users WHERE role = 'system_admin' LIMIT 1");
    if (existing.rowCount) {
      await client.query("COMMIT");
      console.log("Yönetici zaten var, atlandı");
      return;
    }
    // Never log or persist the plaintext password. The application's existing scrypt scheme is reused.
    const hashed = hashPassword(password);
    await client.query(
      "INSERT INTO users(email, password_hash, role, agency_id) VALUES ($1, $2, 'system_admin', NULL)",
      [email, hashed]
    );
    await client.query("COMMIT");
    console.log("Yönetici oluşturuldu");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
