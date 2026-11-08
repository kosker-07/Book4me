// Migration runner (remaining-fixes item A6).
// Applies server/migrations/*.sql in file-name order, each exactly once, and records it in schema_migrations
// (run one runner at a time — deployment runs it as a single step; concurrent runners would conflict on the
// schema_migrations primary key and the second would fail, never apply a file twice in a committed state)
// with the file's SHA-256. A recorded file whose content has changed is an error (migrations are immutable).
//
//   DATABASE_URL=... npm run db:migrate                      apply pending migrations
//   DATABASE_URL=... npm run db:migrate -- --status          list applied / pending
//   DATABASE_URL=... npm run db:migrate -- --baseline 003_draft_sessions_vouchers.sql
//        for a database whose migrations were applied by hand before this runner existed: verifies that the
//        schema objects of every file up to and including the given one exist, then records them as applied
//        without running them. It never runs SQL from those files.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

export const MIGRATIONS_DIR = join(__dirname, "migrations");

export interface MigrationFile { name: string; sql: string; sha256: string }

export function listMigrations(dir = MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir).filter(f => /^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort().map(name => {
    const sql = readFileSync(join(dir, name), "utf8");
    return { name, sql, sha256: createHash("sha256").update(sql).digest("hex") };
  });
}

/** A file manages its own transaction when it contains a top-level BEGIN; (002, 003 do). */
const ownsTransaction = (sql: string) => /^\s*BEGIN\s*;/im.test(sql);

/** Objects whose existence proves that a hand-applied migration ran (used only by --baseline). */
const BASELINE_PROBES: Record<string, string> = {
  "001_initial.sql": "SELECT to_regclass('public.bookings') IS NOT NULL AND to_regclass('public.idempotency_keys') IS NOT NULL AS ok",
  "002_v1_product_rules.sql": "SELECT to_regclass('public.booking_nights') IS NOT NULL AND to_regclass('public.fx_rates') IS NOT NULL AS ok",
  "003_draft_sessions_vouchers.sql": "SELECT to_regclass('public.login_attempts') IS NOT NULL AND to_regclass('public.vouchers') IS NOT NULL AS ok"
};

async function ensureTable(c: Client) {
  await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now(), baseline boolean NOT NULL DEFAULT false)`);
}

export async function migrate(databaseUrl: string, opts: { baseline?: string; status?: boolean; log?: (s: string) => void } = {}) {
  const log = opts.log ?? (s => console.log(s));
  const c = new Client({ connectionString: databaseUrl });
  await c.connect();
  try {
    await ensureTable(c);
    const files = listMigrations();
    const applied = new Map<string, string>((await c.query("SELECT name, sha256 FROM schema_migrations")).rows.map((r: any) => [r.name, r.sha256]));
    for (const [name, sha] of applied) {
      const f = files.find(x => x.name === name);
      if (!f) throw new Error(`Recorded migration ${name} no longer exists in ${MIGRATIONS_DIR}.`);
      if (f.sha256 !== sha) throw new Error(`Migration ${name} was modified after it was applied (sha256 differs). Write a new migration instead.`);
    }
    if (opts.status) {
      for (const f of files) log(`${applied.has(f.name) ? "applied" : "pending"}  ${f.name}`);
      return { applied: [] as string[] };
    }
    if (opts.baseline) {
      const idx = files.findIndex(f => f.name === opts.baseline);
      if (idx < 0) throw new Error(`--baseline ${opts.baseline}: no such migration file.`);
      for (const f of files.slice(0, idx + 1)) {
        if (applied.has(f.name)) continue;
        const probe = BASELINE_PROBES[f.name];
        if (!probe) throw new Error(`--baseline is only supported up to 003; ${f.name} must be applied by the runner.`);
        if (!(await c.query(probe)).rows[0].ok) throw new Error(`--baseline: schema objects of ${f.name} are missing; apply it instead of baselining.`);
        await c.query("INSERT INTO schema_migrations(name, sha256, baseline) VALUES ($1,$2,true)", [f.name, f.sha256]);
        applied.set(f.name, f.sha256);
        log(`baselined ${f.name}`);
      }
    }
    const done: string[] = [];
    for (const f of files) {
      if (applied.has(f.name)) continue;
      if (ownsTransaction(f.sql)) {
        // The file commits itself; it is written to be re-runnable, so a crash between its COMMIT and the
        // record below is repaired by simply running the runner again.
        await c.query(f.sql);
        await c.query("INSERT INTO schema_migrations(name, sha256) VALUES ($1,$2) ON CONFLICT (name) DO NOTHING", [f.name, f.sha256]);
      } else {
        await c.query("BEGIN");
        try {
          await c.query(f.sql);
          await c.query("INSERT INTO schema_migrations(name, sha256) VALUES ($1,$2)", [f.name, f.sha256]);
          await c.query("COMMIT");
        } catch (e) { await c.query("ROLLBACK"); throw e; }
      }
      done.push(f.name);
      log(`applied ${f.name}`);
    }
    if (!done.length) log("no pending migrations");
    return { applied: done };
  } finally {
    await c.end();
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const baseline = args.includes("--baseline") ? args[args.indexOf("--baseline") + 1] : undefined;
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required."); process.exit(2); }
  migrate(process.env.DATABASE_URL, { baseline, status: args.includes("--status") })
    .catch(e => { console.error(`migration failed: ${e instanceof Error ? e.message : e}`); process.exit(1); });
}
