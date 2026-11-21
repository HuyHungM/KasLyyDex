import { wrapCommunityRoute } from "@/lib/community/handlers";

export function GET(request: Request) {
  return wrapCommunityRoute(async (api, req) => api.commentsGet(req), request);
}

export function POST(request: Request) {
  return wrapCommunityRoute(async (api, req) => api.commentPost(req), request);
}
