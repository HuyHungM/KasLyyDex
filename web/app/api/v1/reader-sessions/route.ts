import { wrapProgressionRoute } from "@/lib/progression-api";

export function POST(request: Request) {
  return wrapProgressionRoute((api, req) => api.sessionPost(req), request);
}
