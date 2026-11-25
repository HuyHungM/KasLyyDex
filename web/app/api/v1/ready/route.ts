import { checkReadiness, readinessResponse } from "@/lib/health";

export async function GET() {
  return readinessResponse(await checkReadiness());
}
