import { wrapCommunityRoute } from "@/lib/community/handlers";

export function GET(request: Request, context: { params: Promise<{ userId: string }> }) {
  return wrapCommunityRoute(async (api, req) => api.usersGet(req, await context.params), request);
}
