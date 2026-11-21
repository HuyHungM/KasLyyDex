import { wrapCommunityRoute } from "@/lib/community/handlers";

export function GET(request: Request) {
  return wrapCommunityRoute(async (api, req) => api.moderationReportsGet(req), request);
}
