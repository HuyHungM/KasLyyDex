import { wrapMeRoute } from "@/lib/me/handlers";

export function GET(request: Request) {
  return wrapMeRoute((api, req) => api.levelGet(req), request);
}
