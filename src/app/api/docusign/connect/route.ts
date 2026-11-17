import { verifyConnect } from "@/lib/docusign";
import { handleConnectEvent } from "@/services/contracts";

export const dynamic = "force-dynamic";

/**
 * DocuSign Connect webhook (JSON, SIM format, HMAC on). No staff session: trust comes only from the
 * HMAC signature. Returns 200 once logged so DocuSign does not retry; failures are kept in docusign_event.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 5_000_000) return new Response("Too large", { status: 413 });
  if (!verifyConnect(raw, req.headers)) return new Response("Bad signature", { status: 401 });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  try {
    const r = await handleConnectEvent(payload);
    return Response.json(r);
  } catch (e) {
    console.error("docusign connect", e);
    return new Response("Error recorded", { status: 500 }); // DocuSign retries; repeats are safe
  }
}
