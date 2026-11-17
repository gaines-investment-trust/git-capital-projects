import { requireActor } from "@/auth";

export const dynamic = "force-dynamic";

/** Where DocuSign returns after the one-time consent. Nothing to store: JWT grant works from now on. */
export async function GET(req: Request) {
  await requireActor();
  const err = new URL(req.url).searchParams.get("error");
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>DocuSign</title><body style="font:16px system-ui;padding:40px">${err ? "DocuSign consent was not given. Try again from Settings." : "DocuSign is connected. You can close this tab."}</body>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
