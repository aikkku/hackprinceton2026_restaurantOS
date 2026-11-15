// Public liveness only. No database/provider access or configuration disclosure.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({ ok: true, service: "restaurantos" }, { headers: { "Cache-Control": "no-store" } });
}
