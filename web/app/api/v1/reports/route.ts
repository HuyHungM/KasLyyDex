import { wrapCommunityRoute } from "@/lib/community/handlers";

export function POST(request: Request) {
  return wrapCommunityRoute(async (api, req) => api.reportPost(req), request);
}
