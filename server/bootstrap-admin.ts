import { pool } from "./db";
import { hashPassword } from "./security";

/**
 * One-time first-admin bootstrap, without explicit locks (product rule): a single conditional INSERT creates the
 * account only while no system_admin exists. The UNIQUE e-mail constraint stops concurrent replicas from creating the
 * same account twice; a concurrent duplicate is treated as "already exists".
 */
export async function bootstrapAdmin(): Promise<void> {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";
  if (!email || !password) return;
  // Never log or persist the plaintext password. The application's existing scrypt scheme is reused.
  const hashed = hashPassword(password);
  try {
    const result = await pool.query(
      `INSERT INTO users(email, password_hash, role, agency_id)
       SELECT $1, $2, 'system_admin', NULL
        WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'system_admin')`,
      [email, hashed]);
    console.log(result.rowCount ? "Yönetici oluşturuldu" : "Yönetici zaten var, atlandı");
  } catch (error: any) {
    if (error?.code === "23505") { console.log("Yönetici zaten var, atlandı"); return; }
    throw error;
  }
}
