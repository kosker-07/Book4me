import { pool } from "../db";
import { processOutbox } from "./outbox";

let timer: NodeJS.Timeout | null = null;
export function startMailWorker(intervalMs = 30_000) {
  if (timer || process.env.MAIL_WORKER === "off") return;
  const tick = () => { processOutbox({ db: pool }).catch(e => console.error("mail worker", e?.message || e)); };
  timer = setInterval(tick, intervalMs);
  timer.unref();
}
