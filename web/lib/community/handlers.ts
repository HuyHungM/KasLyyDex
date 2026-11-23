import "server-only";

import type { AppDatabase } from "../db/client";
import { DatabaseConfigurationError, getDatabase } from "../db/client";
import { AuthConfigurationError, getAuth } from "../auth/server";
import { identityFromNetlifyUser, type AccountIdentity } from "../auth/identity";
import type { ContentClient } from "../contracts";
import { errorEnvelope } from "../contracts";
import { logErrorEvent, withObservedRoute } from "../observability";
import { serverContent } from "../content-server";
import {
  parseCommentInput,
  parseCommentPatch,
  parseCursor,
  parseIds,
  parseLimit,
  parseModerationAction,
  parseReportAction,
  parseReportInput,
  parseResourceId,
  parseTargetType,
  parseThreadInput,
  readJson,
  requireOrigin,
} from "../validators";
import { errorToResponse, privateJson } from "../me/handlers";
import { ensureProfile, ServiceError } from "../me/service";
import {
  createComment,
  createReport,
  deleteComment,
  editComment,
  hasModeratorRole,
  listComments,
  listNotifications,
  listReports,
  moderateComment,
  readNotifications,
  refreshFollowedChapters,
  requireModerator,
  resolveReport,
  setThreadLock,
  threadState,
} from "../moderation";

export type CommunityDeps = {
  db: () => AppDatabase;
  identity: () => Promise<AccountIdentity | null>;
  now: () => number;
  allowlist: readonly string[];
  content: () => Promise<ContentClient>;
};

export { errorToResponse, privateJson };

/// Testable community API factory. Production supplies the pooled database and
/// managed-session resolver; tests supply PGlite plus an opaque id obtained
/// from the real SDK fixture. No header or environment bypass exists here.
export function createCommunityApi(deps: CommunityDeps) {
  const db = () => deps.db();
  const now = () => deps.now();

  async function withUser(
    request: Request,
    action: (user: AccountIdentity | null) => Promise<Response>,
    options: { mutate?: boolean; optional?: boolean; moderator?: boolean } = {},
  ): Promise<Response> {
    try {
      if (options.mutate) requireOrigin(request);
      let user: AccountIdentity | null = null;
      try {
        user = await deps.identity();
      } catch (error) {
        if (!(options.optional && error instanceof AuthConfigurationError)) throw error;
      }
      if (!user) {
        if (options.moderator) {
          // Moderator entry points do not distinguish anonymous from reader:
          // neither has the stored role.
          return privateJson(errorEnvelope("FORBIDDEN", "Moderator permission is required."), 403);
        }
        if (!options.optional) {
          return privateJson(errorEnvelope("UNAUTHENTICATED", "Sign in to continue."), 401);
        }
        return action(null);
      }
      await ensureProfile(db(), user, { now: now(), allowlist: deps.allowlist });
      if (options.moderator) await requireModerator(db(), user.id);
      return await action(user);
    } catch (error) {
      return errorToResponse(error);
    }
  }

  return {
    commentsGet: (request: Request) => withUser(request, async (user) => {
      const query = new URL(request.url).searchParams;
      const targetType = parseTargetType(query.get("targetType"));
      const targetId = parseResourceId(query.get("targetId"), "targetId");
      const result = await listComments(
        db(), targetType, targetId, parseCursor(query.get("cursor")),
        parseLimit(query.get("limit")), user?.id ?? null,
      );
      return privateJson(result);
    }, { optional: true }),

    commentPost: (request: Request) => withUser(request, async (user) => {
      const input = parseCommentInput(await readJson(request));
      const comment = await createComment(db(), user!.id, input, now());
      return privateJson({ comment }, 201);
    }, { mutate: true }),

    commentPatch: (request: Request, params: { id: string }) => withUser(request, async (user) => {
      const id = parseResourceId(params.id, "id");
      const patch = parseCommentPatch(await readJson(request));
      const comment = await editComment(db(), user!.id, id, patch, now());
      return privateJson({ comment });
    }, { mutate: true }),

    commentDelete: (request: Request, params: { id: string }) => withUser(request, async (user) => {
      const id = parseResourceId(params.id, "id");
      if (!(await deleteComment(db(), user!.id, id, now()))) {
        return privateJson(errorEnvelope("NOT_FOUND", "Comment not found."), 404);
      }
      return privateJson({ deleted: true });
    }, { mutate: true }),

    reportPost: (request: Request) => withUser(request, async (user) => {
      const input = parseReportInput(await readJson(request));
      const report = await createReport(db(), user!.id, input, now());
      return privateJson({ report }, 201);
    }, { mutate: true }),

    moderationAccessGet: (request: Request) => withUser(request, async (user) => {
      return privateJson({ moderator: user ? await hasModeratorRole(db(), user.id) : false });
    }, { optional: true }),

    moderationReportsGet: (request: Request) => withUser(request, async (user) => {
      const query = new URL(request.url).searchParams;
      const result = await listReports(
        db(), user!.id, parseCursor(query.get("cursor")), parseLimit(query.get("limit")),
      );
      return privateJson(result);
    }, { moderator: true }),

    reportPatch: (request: Request, params: { id: string }) => withUser(request, async (user) => {
      const id = parseResourceId(params.id, "id");
      const action = parseReportAction(await readJson(request));
      if (!(await resolveReport(db(), user!.id, id, action, now()))) {
        return privateJson(errorEnvelope("NOT_FOUND", "Open report not found."), 404);
      }
      return privateJson({ updated: true });
    }, { mutate: true, moderator: true }),

    commentModeratePatch: (request: Request, params: { id: string }) => withUser(request, async (user) => {
      const id = parseResourceId(params.id, "id");
      const action = parseModerationAction(await readJson(request));
      const comment = await moderateComment(db(), user!.id, id, action, now());
      return privateJson({ comment });
    }, { mutate: true, moderator: true }),

    threadGet: (request: Request) => withUser(request, async () => {
      const query = new URL(request.url).searchParams;
      const targetType = parseTargetType(query.get("targetType"));
      const targetId = parseResourceId(query.get("targetId"), "targetId");
      return privateJson({ thread: await threadState(db(), targetType, targetId) });
    }),

    threadPut: (request: Request) => withUser(request, async (user) => {
      const input = parseThreadInput(await readJson(request));
      const thread = await setThreadLock(
        db(), user!.id, input.targetType, input.targetId, input.locked, now(),
      );
      return privateJson({ thread });
    }, { mutate: true, moderator: true }),

    notificationsGet: (request: Request) => withUser(request, async (user) => {
      const query = new URL(request.url).searchParams;
      const result = await listNotifications(
        db(), user!.id, parseCursor(query.get("cursor")), parseLimit(query.get("limit")),
      );
      return privateJson(result);
    }),

    notificationsRefreshPost: (request: Request) => withUser(request, async (user) => {
      const content = await deps.content();
      const result = await refreshFollowedChapters(db(), user!.id, content, now());
      return privateJson(result);
    }, { mutate: true }),

    notificationsReadPost: (request: Request) => withUser(request, async (user) => {
      const body = await readJson(request);
      const ids = parseIds(body.ids);
      const updated = await readNotifications(db(), user!.id, ids, now());
      return privateJson({ updated });
    }, { mutate: true }),
  };
}

export type CommunityApi = ReturnType<typeof createCommunityApi>;

export function resolveSessionIdentity(data: unknown): AccountIdentity | null {
  return identityFromNetlifyUser(data);
}

function readOperatorAllowlist(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.OPERATOR_EMAIL_ALLOWLIST ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/// Production wiring: identity is read from the real managed-auth session
/// cookie. There is no test header, role field or env bypass in this path.
export function productionCommunityApi(): CommunityApi {
  return createCommunityApi({
    db: () => getDatabase(),
    identity: async () => {
      try {
        return await getAuth().getSession();
      } catch (error) {
        if (error instanceof AuthConfigurationError) throw error;
        throw new ServiceError(503, "AUTH_UNAVAILABLE", "Managed authentication is temporarily unavailable.");
      }
    },
    now: () => Date.now(),
    allowlist: readOperatorAllowlist(),
    content: () => serverContent(),
  });
}

export async function wrapCommunityRoute(
  run: (api: CommunityApi, request: Request) => Promise<Response>,
  request: Request,
): Promise<Response> {
  return withObservedRoute("community", request, async () => {
    try {
      return await run(productionCommunityApi(), request);
    } catch (error) {
      if (error instanceof AuthConfigurationError || error instanceof DatabaseConfigurationError) {
        logErrorEvent(error);
        const details: Record<string, string> = { service: error instanceof AuthConfigurationError ? "auth" : "database" };
        if (error.missing.length > 0) details.missing = error.missing.join(",");
        return privateJson(errorEnvelope(error.code, error.message, details), 503);
      }
      return errorToResponse(error);
    }
  });
}
