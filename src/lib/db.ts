import { Pool, types, type PoolClient, type QueryResultRow } from "pg";
import { env } from "./env";

// Keep SQL DATE values as "YYYY-MM-DD" strings so no timezone can shift a schedule date.
types.setTypeParser(1082, (v) => v);

const g = globalThis as unknown as { __gcpPool?: Pool };

/** Created on first use, so importing this module never needs settings. */
export function getPool(): Pool {
  if (!g.__gcpPool) {
    g.__gcpPool = new Pool({
      connectionString: env().DATABASE_URL,
      ssl: env().DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
      max: 10,
    });
    // An idle connection dropped by the server (failover, maintenance restart) must not crash the app;
    // the pool discards it and opens a new one on the next query.
    g.__gcpPool.on("error", (e) => console.error("[db] idle connection error, will reconnect:", e.message));
  }
  return g.__gcpPool;
}

export const pool = {
  query: (sql: string, params?: unknown[]) => getPool().query(sql, params),
  end: async () => {
    if (g.__gcpPool) await g.__gcpPool.end();
    g.__gcpPool = undefined;
  },
};

export async function query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await getPool().query<T>(sql, params);
  return r.rows;
}

export async function one<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/**
 * Run work in a transaction. The acting user id is set as `app.user_id`
 * so the audit trigger records who made each change (design section 4.2).
 */
export async function withTx<T>(actorUserId: string | null, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await getPool().connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.user_id', $1, true)", [actorUserId ?? ""]);
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
