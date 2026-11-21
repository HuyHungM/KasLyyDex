import "server-only";

import type { AppDatabase } from "../db/client";
import { DatabaseConfigurationError, getDatabase } from "../db/client";
import { AuthConfigurationError, getAuth } from "../auth/server";
import { identityFromSession, type AccountIdentity } from "../auth/identity";
import { errorEnvelope } from "../contracts";
import {
  boundedClientTime,
  parseImportPayload,
  parseLanguage,
  parseLibraryInput,
  parseProfilePatch,
  parseProgressInput,
  parseResourceId,
  parseSettingsInput,
  readJson,
  requireOrigin,
  ValidationError,
} from "../validators";
import { ServiceError, ensureProfile, getLevel, importGuest, listLibrary, listProgress, putLibrary, putProgress, deleteLibrary, deleteProgress, getSettings, putSettings, updateProfile } from "./service";

export type MeDeps = {
  db: () => AppDatabase;
  identity: () => Promise<AccountIdentity | null>;
  now: () => number;
  allowlist: readonly string[];
};

export function privateJson(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "private, no-store",
      vary: "Cookie",
      "x-content-type-options": "nosniff",
    },
  });
}

export function errorToResponse(error: unknown): Response {
  if (error instanceof ValidationError) {
    return privateJson(errorEnvelope(error.code, error.message), error.status);
  }
  if (error instanceof ServiceError) {
    return privateJson(errorEnvelope(error.code, error.message), error.status);
  }
  if (error instanceof AuthConfigurationError || error instanceof DatabaseConfigurationError) {
    const details: Record<string, string> = { service: error instanceof AuthConfigurationError ? "auth" : "database" };
    if (error.missing.length > 0) details.missing = error.missing.join(",");
    return privateJson(errorEnvelope(error.code, error.message, details), 503);
  }
  return privateJson(errorEnvelope("INTERNAL_ERROR", "Account request failed."), 500);
}

/// Testable account API factory. Production route files supply the real pooled
/// database and managed-session resolver; tests supply PGlite plus an identity
/// obtained from the real SDK fixture. No header/env bypass exists here.
export function createMeApi(deps: MeDeps) {
  const now = () => deps.now();
  const db = () => deps.db();

  async function withUser(
    request: Request,
    action: (user: AccountIdentity) => Promise<Response>,
    mutate = false,
  ): Promise<Response> {
    try {
      if (mutate) requireOrigin(request);
      const user = await deps.identity();
      if (!user) {
        return privateJson(errorEnvelope("UNAUTHENTICATED", "Sign in to access account data."), 401);
      }
      await ensureProfile(db(), user, { now: now(), allowlist: deps.allowlist });
      return await action(user);
    } catch (error) {
      return errorToResponse(error);
    }
  }

  return {
    meGet: (request: Request) => withUser(request, async (user) => {
      const profile = await ensureProfile(db(), user, { now: now(), allowlist: deps.allowlist });
      const settings = await getSettings(db(), user.id);
      return privateJson({ profile, settings });
    }),

    mePatch: (request: Request) => withUser(request, async (user) => {
      const patch = parseProfilePatch(await readJson(request));
      const profile = await updateProfile(db(), user.id, patch, now());
      return privateJson({ profile });
    }, true),

    levelGet: (request: Request) => withUser(request, async (user) =>
      privateJson(await getLevel(db(), user.id))),

    libraryGet: (request: Request) => withUser(request, async (user) => {
      const items = await listLibrary(db(), user.id);
      return privateJson({ items });
    }),

    libraryPut: (request: Request, params: { mangaId: string }) => withUser(request, async (user) => {
      const mangaId = parseResourceId(params.mangaId, "mangaId");
      const input = parseLibraryInput(await readJson(request));
      const item = await putLibrary(db(), user.id, mangaId, input, now());
      return privateJson({ item });
    }, true),

    libraryDelete: (request: Request, params: { mangaId: string }) => withUser(request, async (user) => {
      const mangaId = parseResourceId(params.mangaId, "mangaId");
      const deleted = await deleteLibrary(db(), user.id, mangaId);
      if (!deleted) return privateJson(errorEnvelope("NOT_FOUND", "Library entry not found."), 404);
      return privateJson({ deleted: true });
    }, true),

    progressGet: (request: Request) => withUser(request, async (user) => {
      const items = await listProgress(db(), user.id);
      return privateJson({ items });
    }),

    progressPut: (request: Request, params: { chapterId: string }) => withUser(request, async (user) => {
      const chapterId = parseResourceId(params.chapterId, "chapterId");
      const input = parseProgressInput(await readJson(request));
      const item = await putProgress(db(), user.id, chapterId, input, now());
      return privateJson({ item });
    }, true),

    progressDelete: (request: Request, params: { chapterId: string }) => withUser(request, async (user) => {
      const chapterId = parseResourceId(params.chapterId, "chapterId");
      const query = new URL(request.url).searchParams;
      const mangaId = parseResourceId(query.get("mangaId"), "mangaId");
      const rawLanguage = query.get("lang");
      if (!rawLanguage) throw new ValidationError(400, "INVALID_INPUT", "lang is required to delete progress.");
      const language = parseLanguage(rawLanguage);
      const deleted = await deleteProgress(db(), user.id, chapterId, mangaId, language);
      if (!deleted) return privateJson(errorEnvelope("NOT_FOUND", "Progress entry not found."), 404);
      return privateJson({ deleted: true });
    }, true),

    settingsGet: (request: Request) => withUser(request, async (user) => {
      const settings = await getSettings(db(), user.id);
      return privateJson(settings);
    }),

    settingsPut: (request: Request) => withUser(request, async (user) => {
      const settings = parseSettingsInput(await readJson(request));
      return privateJson(await putSettings(db(), user.id, settings, now()));
    }, true),

    importPost: (request: Request) => withUser(request, async (user) => {
      const body = await readJson(request);
      const timestamp = now();
      const payload = parseImportPayload(body, timestamp);
      // The bounded timestamp is enforced per item; this is a defensive check
      // that the server clock itself is usable.
      if (boundedClientTime(timestamp, timestamp) === null) {
        throw new ValidationError(400, "INVALID_INPUT", "Server timestamp is invalid.");
      }
      const summary = await importGuest(db(), user.id, payload, timestamp);
      return privateJson(summary);
    }, true),
  };
}

export function resolveSessionIdentity(data: unknown): AccountIdentity | null {
  return identityFromSession(data);
}

function readOperatorAllowlist(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.OPERATOR_EMAIL_ALLOWLIST ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/// Production wiring only: the user id comes from the real managed-auth
/// session cookie, never from a header or request body.
export function productionMeApi() {
  return createMeApi({
    db: () => getDatabase(),
    identity: async () => {
      try {
        const { data, error } = await getAuth().getSession();
        if (error) return null;
        return identityFromSession(data);
      } catch (error) {
        if (error instanceof AuthConfigurationError) throw error;
        throw new ServiceError(503, "AUTH_UNAVAILABLE", "Managed authentication is temporarily unavailable.");
      }
    },
    now: () => Date.now(),
    allowlist: readOperatorAllowlist(),
  });
}

export async function wrapMeRoute(
  run: (api: ReturnType<typeof createMeApi>, request: Request) => Promise<Response>,
  request: Request,
): Promise<Response> {
  try {
    return await run(productionMeApi(), request);
  } catch (error) {
    return errorToResponse(error);
  }
}
