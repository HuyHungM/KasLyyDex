import { version } from "../../../../package.json";

// Liveness only: no env, DB or upstream access and therefore no secrets.
// Readiness lives at /api/v1/ready.
export function GET() {
  return Response.json(
    { ok: true, version },
    { headers: { "cache-control": "no-store" } },
  );
}
