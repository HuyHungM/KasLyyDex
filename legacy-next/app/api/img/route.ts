import { agent, undiciFetch } from "@/lib/http";

// Image proxy with a strict host allowlist (SSRF-safe).
const ALLOWED = (h: string) => h === "uploads.mangadex.org" || h.endsWith(".mangadex.network");

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("u") || "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return new Response("Bad url", { status: 400 });
  }
  if (url.protocol !== "https:" || !ALLOWED(url.hostname)) {
    return new Response("Host not allowed", { status: 400 });
  }
  try {
    const up = await undiciFetch(url.toString(), {
      dispatcher: agent,
      redirect: "error", // never follow redirects into arbitrary hosts (SSRF)
      headers: { "User-Agent": "TruyenvietReader/1.0 (educational demo)" },
    });
    if (!up.ok || !up.body) return new Response("Upstream error", { status: 502 });
    return new Response(up.body as unknown as BodyInit, {
      headers: {
        "Content-Type": up.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new Response("Upstream unreachable", { status: 502 });
  }
}