import { wrapCommunityRoute } from "@/lib/community/handlers";

export function GET(request: Request) {
  return wrapCommunityRoute(async (api, req) => api.threadGet(req), request);
}

export function PUT(request: Request) {
  return wrapCommunityRoute(async (api, req) => api.threadPut(req), request);
}
