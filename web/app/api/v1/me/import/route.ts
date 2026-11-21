import { wrapMeRoute } from "@/lib/me/handlers";

export function POST(request: Request) {
  return wrapMeRoute((api, req) => api.importPost(req), request);
}
