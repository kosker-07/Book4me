// AES-256-GCM for mail credentials stored at rest. Key: MAIL_SECRET_KEY (base64, exactly 32 bytes).
// Stored form: base64(iv[12] | tag[16] | ciphertext). Credentials are write-only: no API ever returns them.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const raw = process.env.MAIL_SECRET_KEY || "";
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("MAIL_SECRET_KEY must be base64 of exactly 32 bytes");
  return buf;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptSecret(stored: string): string {
  const buf = Buffer.from(stored, "base64");
  if (buf.length < 29) throw new Error("INVALID_SECRET");
  const decipher = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}
