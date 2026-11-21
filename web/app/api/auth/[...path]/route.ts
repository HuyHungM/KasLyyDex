import type { NextRequest } from "next/server";
import { authErrorResponse, getAuth } from "@/lib/auth/server";
import { errorEnvelope } from "@/lib/contracts";

type Context = { params: Promise<{ path: string[] }> };

async function handle(request: NextRequest, context: Context) {
  try {
    const handlers = getAuth().handler();
    switch (request.method) {
      case "GET":
      case "POST":
      case "PUT":
      case "PATCH":
      case "DELETE":
        return await handlers[request.method](request, context);
      default:
        return Response.json(
          errorEnvelope("METHOD_NOT_ALLOWED", "Method not allowed."),
          { status: 405, headers: { Allow: "GET, POST, PUT, PATCH, DELETE" } },
        );
    }
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
