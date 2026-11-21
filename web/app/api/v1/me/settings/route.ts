import { wrapMeRoute } from "@/lib/me/handlers";

export function GET(request: Request) {
  return wrapMeRoute((api, req) => api.settingsGet(req), request);
}

export function PUT(request: Request) {
  return wrapMeRoute((api, req) => api.settingsPut(req), request);
}
