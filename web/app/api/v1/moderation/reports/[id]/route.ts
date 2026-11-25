import { wrapCommunityRoute } from "@/lib/community/handlers";

type Context = { params: Promise<{ id: string }> };

export function PATCH(request: Request, context: Context) {
  return wrapCommunityRoute(async (api, req) => api.reportPatch(req, await context.params), request);
}
