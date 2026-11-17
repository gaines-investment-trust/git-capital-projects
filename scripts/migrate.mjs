// Plain-JS migration runner for the production image (no TypeScript tooling there).
// Same behaviour as scripts/migrate.ts. Usage: node scripts/migrate.mjs
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const ssl = process.env.DATABASE_SSL === "1" || process.env.DATABASE_SSL === "true";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: ssl ? { rejectUnauthorized: true } : undefined });
await c.connect();
await c.query(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
const done = new Set((await c.query("select name from schema_migrations")).rows.map((r) => r.name));
const dir = join(process.cwd(), "db", "migrations");
for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
  if (done.has(f)) continue;
  process.stdout.write(`applying ${f} ... `);
  try {
    await c.query("begin");
    await c.query(readFileSync(join(dir, f), "utf8"));
    await c.query("insert into schema_migrations(name) values ($1)", [f]);
    await c.query("commit");
    console.log("ok");
  } catch (e) {
    await c.query("rollback");
    console.log("FAILED");
    console.error(e);
    process.exit(1);
  }
}
await c.end();
