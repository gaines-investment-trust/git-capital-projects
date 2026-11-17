import { pool } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await pool.query("select 1");
    return Response.json({ ok: true, db: "up", at: new Date().toISOString() });
  } catch (e) {
    return Response.json({ ok: false, db: "down" }, { status: 503 });
  }
}
