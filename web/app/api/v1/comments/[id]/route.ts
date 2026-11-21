import { wrapCommunityRoute } from "@/lib/community/handlers";

type Context = { params: Promise<{ id: string }> };

export function PATCH(request: Request, context: Context) {
  return wrapCommunityRoute(async (api, req) => api.commentPatch(req, await context.params), request);
}

export function DELETE(request: Request, context: Context) {
  return wrapCommunityRoute(async (api, req) => api.commentDelete(req, await context.params), request);
}
