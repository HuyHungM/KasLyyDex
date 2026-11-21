import { wrapMeRoute } from "@/lib/me/handlers";

type Context = { params: Promise<{ mangaId: string }> };

export function PUT(request: Request, context: Context) {
  return wrapMeRoute(async (api, req) => api.libraryPut(req, await context.params), request);
}

export function DELETE(request: Request, context: Context) {
  return wrapMeRoute(async (api, req) => api.libraryDelete(req, await context.params), request);
}
