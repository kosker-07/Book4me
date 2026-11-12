// Creates the first system administrator. The password is read from standard input (never from argv,
// so it does not end up in shell history or process listings) and is never logged.
//   echo -n 'a-long-password' | DATABASE_URL=... npm run admin:create -- admin@bed4book.com
//   (compiled: node dist-server/server/cli/create-admin.js admin@bed4book.com)
import { pool } from "../db";
import { hashPassword } from "../security";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

async function main() {
  const email = String(process.argv[2] || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Usage: create-admin <email>  (password on stdin)");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const password = await readStdin();
  if (password.length < 12) throw new Error("Password must contain at least 12 characters.");
  const existing = await pool.query("SELECT 1 FROM users WHERE lower(email) = $1", [email]);
  if (existing.rowCount) throw new Error(`A user with e-mail ${email} already exists.`);
  const result = await pool.query(
    "INSERT INTO users(email, password_hash, role, agency_id) VALUES ($1, $2, 'system_admin', NULL) RETURNING id", [email, hashPassword(password)]);
  console.log(`System administrator created: ${email} (${result.rows[0].id})`);
}

main().then(() => pool.end()).catch(async error => {
  console.error(error instanceof Error ? error.message : String(error));
  await pool.end();
  process.exit(1);
});
