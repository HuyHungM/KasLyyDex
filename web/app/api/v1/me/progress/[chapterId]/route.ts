import { wrapMeRoute } from "@/lib/me/handlers";

type Context = { params: Promise<{ chapterId: string }> };

export function PUT(request: Request, context: Context) {
  return wrapMeRoute(async (api, req) => api.progressPut(req, await context.params), request);
}

export function DELETE(request: Request, context: Context) {
  return wrapMeRoute(async (api, req) => api.progressDelete(req, await context.params), request);
}
