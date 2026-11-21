import { wrapMeRoute } from "@/lib/me/handlers";

export function GET(request: Request) {
  return wrapMeRoute((api, req) => api.meGet(req), request);
}

export function PATCH(request: Request) {
  return wrapMeRoute((api, req) => api.mePatch(req), request);
}
