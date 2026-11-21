import { connection } from "next/server";
import { wrapCommunityRoute } from "@/lib/community/handlers";

export async function GET(request: Request) {
  // Capability is session-specific: never prerender a shared "not moderator".
  await connection();
  return wrapCommunityRoute(async (api, req) => api.moderationAccessGet(req), request);
}
