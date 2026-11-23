import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, count, eq, gt, sql } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import { getDatabase, type AppDatabase } from "./db/client";
import * as tables from "./db/schema";
import { AuthConfigurationError, getAuth } from "./auth/server";
import type { AccountIdentity } from "./auth/identity";
import { serverContent } from "./content-server";
import type { ContentClient } from "./contracts";
import { errorEnvelope } from "./contracts";
import { logErrorEvent, withObservedRoute } from "./observability";
import { errorToResponse, privateJson } from "./me/handlers";
import { ServiceError, ensureProfile } from "./me/service";
import { emitNotification } from "./moderation";
import { parseLanguage, parseResourceId, parseContentId, parseContentSource, readJson, requireOrigin, ValidationError } from "./validators";
import type { ContentSource } from "./validators";
import { sourceLabel } from "./contracts";
import {
  CHECKPOINT_LIMIT, MAX_PAGE_COUNT, PROGRESSION_RULE_VERSION,
  READER_TICKET_TTL_SECONDS, XP_PER_CHAPTER, levelFromXp, minimumElapsedMs,
  progressionForXp, requiredPages,
} from "./progression";

// Pooled and transaction databases share these calls; `$client` exists only on
// the pooled handle, exactly as in the Task 7 moderation services.
type Db = Omit<AppDatabase, "$client">;

const ISSUER = "kaslyydex-reader";
const AUDIENCE = "kaslyydex-reader";
const COMPLETE_LIMIT = 10;
const SESSION_LIMIT = 30;
const WINDOW_MS = 60_000;
const MAX_CHECKPOINT_PAGES = 500;
const CONTENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class TicketSecretError extends Error {
  readonly code = "READER_TICKET_NOT_CONFIGURED";
  readonly missing = ["READER_TICKET_SECRET"];
  constructor(message = "Reader ticket signing secret is not configured.") {
    super(message);
    this.name = "TicketSecretError";
  }
}

/// Missing or short secrets fail closed. No known default key exists and no
/// request may provide one.
export function readTicketSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.READER_TICKET_SECRET?.trim();
  if (!secret || secret.length < 32) throw new TicketSecretError();
  return secret;
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export type TicketClaims = {
  sid: string;
  sub: string;
  cid: string;
  mid: string;
  lang: string;
  source: ContentSource;
  pages: number;
  iat: number;
  exp: number;
};

export async function signTicket(secret: string, claims: TicketClaims): Promise<string> {
  return new SignJWT({
    sid: claims.sid, sub: claims.sub, cid: claims.cid, mid: claims.mid,
    lang: claims.lang, source: claims.source, pages: claims.pages,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(claims.iat)
    .setExpirationTime(claims.exp)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .sign(secretKey(secret));
}

/// Verifies the HMAC, registered claims and our own claim shape. `now` is
/// injected by the service factory only; production supplies Date.now().
export async function verifyTicket(token: string, secret: string, nowMs: number): Promise<TicketClaims> {
  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(token, secretKey(secret), {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
      currentDate: new Date(nowMs),
    });
    payload = result.payload as Record<string, unknown>;
  } catch {
    throw new ServiceError(401, "INVALID_TICKET", "Reader session ticket is invalid or expired.");
  }
  const text = (key: string, max: number): string => {
    const value = payload[key];
    if (typeof value !== "string" || value.length === 0 || value.length > max) {
      throw new ServiceError(401, "INVALID_TICKET", "Reader session ticket is invalid.");
    }
    return value;
  };
  const integer = (key: string): number => {
    const value = payload[key];
    if (!Number.isSafeInteger(value)) throw new ServiceError(401, "INVALID_TICKET", "Reader session ticket is invalid.");
    return value as number;
  };
  const claims: TicketClaims = {
    sid: text("sid", 200), sub: text("sub", 200), cid: text("cid", 200),
    mid: text("mid", 200), lang: text("lang", 20), source: text("source", 20) as ContentSource,
    pages: integer("pages"), iat: integer("iat"), exp: integer("exp"),
  };
  try {
    parseContentSource(claims.source);
  } catch {
    throw new ServiceError(401, "INVALID_TICKET", "Reader session ticket is invalid.");
  }
  if (claims.pages < 1 || claims.pages > MAX_PAGE_COUNT
    || claims.exp - claims.iat !== READER_TICKET_TTL_SECONDS || claims.exp * 1000 <= nowMs) {
    throw new ServiceError(401, "INVALID_TICKET", "Reader session ticket is invalid or expired.");
  }
  return claims;
}

function date(ms: number): Date {
  return new Date(Number.isFinite(ms) ? ms : Date.now());
}

function excluded(column: string) {
  return sql.raw(`excluded."${column}"`);
}

function assertKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new ValidationError(400, "INVALID_INPUT", `Unexpected field: ${unknown[0]}`);
  }
}

/// Sliding window in SQL with a transaction-scoped advisory lock: no
/// process-local counters, and rejected requests roll back with the caller.
async function consumeRateLimit(
  db: Db,
  userId: string,
  action: "reader_checkpoint" | "reader_complete" | "reader_session",
  now: number,
  max: number,
): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${"progression-rate:" + action + ":" + userId}))`);
  await db.delete(tables.actionEvents).where(and(
    eq(tables.actionEvents.userId, userId),
    eq(tables.actionEvents.action, action),
    sql`${tables.actionEvents.occurredAt} <= ${now - WINDOW_MS}`,
  ));
  await db.insert(tables.actionEvents).values({ id: randomUUID(), userId, action, occurredAt: now });
  const rows = await db.select({ value: count() }).from(tables.actionEvents).where(and(
    eq(tables.actionEvents.userId, userId),
    eq(tables.actionEvents.action, action),
    gt(tables.actionEvents.occurredAt, now - WINDOW_MS),
  ));
  if ((rows[0]?.value ?? 0) > max) {
    throw new ServiceError(429, "RATE_LIMITED", "Too many reading requests. Try again shortly.");
  }
}

type SessionRow = typeof tables.readerSessions.$inferSelect;

async function loadSession(
  db: Db,
  claims: TicketClaims,
  user: AccountIdentity,
  now: number,
): Promise<SessionRow> {
  if (claims.sub !== user.id) throw new ServiceError(403, "INVALID_TICKET_OWNER", "This ticket belongs to another account.");
  const rows = await db.select().from(tables.readerSessions)
    .where(and(eq(tables.readerSessions.id, claims.sid), eq(tables.readerSessions.userId, user.id)))
    .limit(1);
  const session = rows[0];
  if (!session) throw new ServiceError(401, "INVALID_TICKET", "Reader session no longer exists.");
  if (session.chapterId !== claims.cid || session.mangaId !== claims.mid
    || session.language !== claims.lang || session.pageCount !== claims.pages
    || session.source !== claims.source
    || session.issuedAt !== claims.iat * 1000 || session.expiresAt !== claims.exp * 1000) {
    throw new ServiceError(401, "INVALID_TICKET", "Ticket does not match the persisted session.");
  }
  if (session.expiresAt <= now) throw new ServiceError(401, "TICKET_EXPIRED", "Reader session has expired.");
  return session;
}

async function observedPages(db: Db, sessionId: string): Promise<number[]> {
  const rows = await db.select({ page: tables.readerCheckpoints.page })
    .from(tables.readerCheckpoints)
    .where(eq(tables.readerCheckpoints.sessionId, sessionId))
    .orderBy(asc(tables.readerCheckpoints.page));
  return rows.map((row) => row.page);
}

export type ProgressionDeps = {
  db: () => AppDatabase;
  identity: () => Promise<AccountIdentity | null>;
  now: () => number;
  content: () => ContentClient | Promise<ContentClient>;
  secret: () => string;
  allowlist?: readonly string[];
  // Test harness only. Production never supplies it; no environment bypass.
  hooks?: { beforeCommit?: (phase: string) => void | Promise<void> };
};

export function progressionErrorResponse(error: unknown): Response {
  if (error instanceof TicketSecretError) {
    logErrorEvent(error);
    return privateJson(errorEnvelope(error.code, error.message, { service: "reader", missing: "READER_TICKET_SECRET" }), 503);
  }
  return errorToResponse(error);
}

export function createProgressionApi(deps: ProgressionDeps) {
  async function withUser(request: Request, action: (user: AccountIdentity) => Promise<Response>): Promise<Response> {
    try {
      requireOrigin(request);
      const user = await deps.identity();
      if (!user) return privateJson(errorEnvelope("UNAUTHENTICATED", "Sign in before reading with an account."), 401);
      deps.secret(); // fail closed before any upstream or database work
      return await action(user);
    } catch (error) {
      return progressionErrorResponse(error);
    }
  }

  return {
    /// Authority comes from Axum's single-chapter entity plus the actual image
    /// list, never from a client percentage or page count.
    sessionPost: (request: Request) => withUser(request, async (user) => {
      const body = await readJson(request, 2048);
      assertKeys(body, ["chapterId", "mangaId", "lang", "source", "source_label"]);
      const { id: chapterId, source } = parseContentId(body.chapterId, "chapterId");
      const mangaId = parseResourceId(body.mangaId, "mangaId");
      if (!CONTENT_ID.test(mangaId)) {
        throw new ValidationError(400, "INVALID_INPUT", "mangaId must be a MangaDex UUID.");
      }
      const lang = parseLanguage(body.lang);
      // `source`/`source_label` are optional on the wire for legacy MangaDex
      // clients; when present they must be canonical and agree with the id.
      if (body.source !== undefined || body.source_label !== undefined) {
        if (body.source === undefined || body.source_label === undefined) {
          throw new ValidationError(400, "INVALID_INPUT", "source and source_label must be sent together.");
        }
        const claimed = parseContentSource(body.source);
        if (claimed !== source) {
          throw new ServiceError(409, "CONTENT_MISMATCH", "Chapter source does not match its id.");
        }
        if (body.source_label !== sourceLabel(source)) {
          throw new ValidationError(400, "INVALID_INPUT", "source_label is not the canonical label.");
        }
      }
      const now = deps.now();
      const db = deps.db();
      await ensureProfile(db, user, { now, allowlist: deps.allowlist ?? [] });
      await db.transaction(async (tx) => {
        await consumeRateLimit(tx, user.id, "reader_session", now, SESSION_LIMIT);
      });

      let metadata;
      let images;
      try {
        const client = await deps.content();
        [metadata, images] = await Promise.all([
          client.chapterMetadata(chapterId),
          client.pages(chapterId),
        ]);
      } catch {
        throw new ServiceError(503, "CONTENT_METADATA_UNAVAILABLE", "Chapter metadata is temporarily unavailable.");
      }
      // A missing or malformed entity is never a ticket source.
      if (typeof metadata?.id !== "string" || typeof metadata.manga_id !== "string"
        || typeof metadata.lang !== "string" || typeof metadata.pages !== "number"
        || typeof metadata.unavailable !== "boolean"
        || (metadata.external_url !== null && typeof metadata.external_url !== "string")
        || !Array.isArray(images?.pages)) {
        throw new ServiceError(503, "CONTENT_METADATA_UNAVAILABLE", "Chapter metadata is incomplete.");
      }
      if (metadata.id !== chapterId || metadata.manga_id !== mangaId || metadata.lang !== lang) {
        throw new ServiceError(409, "CONTENT_MISMATCH", "Chapter does not belong to this manga and language.");
      }
      if (metadata.unavailable || metadata.external_url
        || !Number.isInteger(metadata.pages) || metadata.pages < 1 || metadata.pages > MAX_PAGE_COUNT
        || images.pages.length === 0 || images.pages.length > MAX_PAGE_COUNT) {
        throw new ServiceError(409, "CONTENT_UNAVAILABLE", "This chapter has no readable pages here.");
      }
      if (metadata.pages !== images.pages.length) {
        throw new ServiceError(409, "CONTENT_MISMATCH", "Chapter page count differs from the image list.");
      }

      // Align to whole seconds so the JWT iat/exp match the persisted row.
      const issuedAt = Math.floor(now / 1000) * 1000;
      const session = {
        id: randomUUID(), userId: user.id, chapterId, mangaId, language: lang, source,
        pageCount: metadata.pages, issuedAt,
        expiresAt: issuedAt + READER_TICKET_TTL_SECONDS * 1000,
      };
      await db.insert(tables.readerSessions).values({ ...session, createdAt: date(now) });
      const ticket = await signTicket(deps.secret(), {
        sid: session.id, sub: user.id, cid: chapterId, mid: mangaId, lang, source,
        pages: session.pageCount,
        iat: Math.floor(session.issuedAt / 1000), exp: Math.floor(session.expiresAt / 1000),
      });
      return privateJson({
        ticket, sessionId: session.id, chapterId, mangaId, lang, source,
        source_label: sourceLabel(source),
        pageCount: session.pageCount, expiresAt: session.expiresAt,
        requiredPages: requiredPages(session.pageCount),
        minimumElapsedMs: minimumElapsedMs(session.pageCount),
      });
    }),

    checkpointPost: (request: Request) => withUser(request, async (user) => {
      const body = await readJson(request, 2048);
      assertKeys(body, ["ticket", "pages", "lastPageSeen"]);
      const token = body.ticket;
      if (typeof token !== "string" || token.length > 4096) {
        throw new ValidationError(400, "INVALID_INPUT", "ticket is required.");
      }
      const now = deps.now();
      const claims = await verifyTicket(token, deps.secret(), now);
      const session = await loadSession(deps.db(), claims, user, now);

      let additions: number[];
      if (body.pages !== undefined) {
        if (!Array.isArray(body.pages) || body.pages.length > MAX_CHECKPOINT_PAGES
          || body.pages.some((page) => !Number.isSafeInteger(page))) {
          throw new ValidationError(400, "INVALID_INPUT", "pages must be a bounded array of page numbers.");
        }
        additions = body.pages as number[];
      } else if (body.lastPageSeen !== undefined) {
        // Legacy interface: a single observed page, never a visited range.
        if (!Number.isSafeInteger(body.lastPageSeen)) {
          throw new ValidationError(400, "INVALID_INPUT", "lastPageSeen must be a page number.");
        }
        additions = [body.lastPageSeen as number];
      } else {
        throw new ValidationError(400, "INVALID_INPUT", "pages is required.");
      }
      if (additions.some((page) => page < 1 || page > session.pageCount)) {
        throw new ValidationError(400, "INVALID_INPUT", "Page is outside this chapter.");
      }

      return deps.db().transaction(async (tx) => {
        await consumeRateLimit(tx, user.id, "reader_checkpoint", now, CHECKPOINT_LIMIT);
        await tx.insert(tables.readerCheckpoints).values(
          [...new Set(additions)].map((page) => ({ sessionId: session.id, page, seenAt: now })),
        ).onConflictDoNothing();
        const seen = await observedPages(tx, session.id);
        const need = requiredPages(session.pageCount);
        return privateJson({
          sessionId: session.id, seenPages: seen, pageCount: session.pageCount,
          requiredPages: need, complete: seen.length >= need,
        });
      });
    }),

    completePost: (request: Request) => withUser(request, async (user) => {
      const body = await readJson(request, 2048);
      assertKeys(body, ["ticket"]);
      const token = body.ticket;
      if (typeof token !== "string" || token.length > 4096) {
        throw new ValidationError(400, "INVALID_INPUT", "ticket is required.");
      }
      const now = deps.now();
      const claims = await verifyTicket(token, deps.secret(), now);
      const session = await loadSession(deps.db(), claims, user, now);

      return deps.db().transaction(async (tx) => {
        await consumeRateLimit(tx, user.id, "reader_complete", now, COMPLETE_LIMIT);
        // Serialize every chapter completion by the same account: concurrent
        // sessions cannot read a stale total or emit duplicate level events.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"progression-profile:" + user.id}))`);
        const seen = await observedPages(tx, session.id);
        const need = requiredPages(session.pageCount);
        if (seen.length < need) {
          throw new ServiceError(409, "COVERAGE_INSUFFICIENT", "Not enough distinct pages were observed.");
        }
        if (now - session.issuedAt < minimumElapsedMs(session.pageCount)) {
          throw new ServiceError(429, "TOO_FAST", "This chapter was completed too quickly.");
        }
        const lastPageSeen = Math.max(...seen);
        await tx.insert(tables.chapterProgress).values({
          userId: user.id, mangaId: session.mangaId, chapterId: session.chapterId,
          language: session.language, chapter: null, title: null, coverFile: null,
          page: lastPageSeen, maxPage: lastPageSeen, total: session.pageCount,
          lastReadAt: now, revision: 1, updatedAt: date(now),
        }).onConflictDoUpdate({
          target: [
            tables.chapterProgress.userId, tables.chapterProgress.mangaId,
            tables.chapterProgress.chapterId, tables.chapterProgress.language,
          ],
          set: {
            // `page` is the ordinary reread position owned by PUT /me/progress;
            // completion evidence must never move it on conflict. Only the
            // monotone max page consumes this session's observed last page.
            maxPage: sql`greatest(${tables.chapterProgress.maxPage}, ${excluded("page")})`,
            total: excluded("total"),
            lastReadAt: sql`greatest(${tables.chapterProgress.lastReadAt} + 1, ${excluded("last_read_at")})`,
            revision: sql`${tables.chapterProgress.revision} + 1`,
            updatedAt: date(now),
          },
        });

        const completion = await tx.insert(tables.readingCompletions).values({
          userId: user.id, chapterId: session.chapterId, mangaId: session.mangaId,
          language: session.language, pageCount: session.pageCount, lastPageSeen,
          readerSessionId: session.id, completedAt: now,
        }).onConflictDoNothing().returning({ userId: tables.readingCompletions.userId });

        const profileRows = await tx.select({ totalXp: tables.profiles.totalXp, level: tables.profiles.level })
          .from(tables.profiles).where(eq(tables.profiles.userId, user.id)).limit(1).for("update");
        const before = profileRows[0];
        if (!before) throw new ServiceError(404, "PROFILE_UNAVAILABLE", "Account profile is missing.");
        let totalXp = before.totalXp;
        let awarded = false;
        if (completion.length > 0) {
          const event = await tx.insert(tables.xpEvents).values({
            id: randomUUID(), userId: user.id, eventType: "chapter_complete",
            chapterId: session.chapterId, amount: XP_PER_CHAPTER,
            ruleVersion: PROGRESSION_RULE_VERSION, createdAt: date(now),
          }).onConflictDoNothing().returning({ id: tables.xpEvents.id });
          if (event.length > 0) {
            awarded = true;
            totalXp += XP_PER_CHAPTER;
            const level = levelFromXp(totalXp);
            await tx.update(tables.profiles)
              .set({ totalXp, level, updatedAt: date(now) })
              .where(eq(tables.profiles.userId, user.id));
            if (level > before.level) {
              const snapshot = progressionForXp(totalXp);
              await emitNotification(tx, {
                userId: user.id, type: "level_up", eventKey: `level:${level}`,
                title: `Đạt cấp ${level}`,
                body: `Bạn đã đạt cấp ${level} · ${snapshot.title}.`,
                href: "/tai-khoan",
              });
            }
          }
        }
        // Old rows may predate the persisted level column; keep it consistent
        // even on idempotent retries without minting another XP event.
        const consistentLevel = levelFromXp(totalXp);
        if (consistentLevel !== before.level && !awarded) {
          await tx.update(tables.profiles)
            .set({ level: consistentLevel, updatedAt: date(now) })
            .where(eq(tables.profiles.userId, user.id));
        }
        await deps.hooks?.beforeCommit?.("complete");
        const snapshot = progressionForXp(totalXp);
        return privateJson({
          awarded, xp: XP_PER_CHAPTER, level: snapshot.level, totalXp: snapshot.totalXp,
          title: snapshot.title, realm: snapshot.realm.key, ruleVersion: snapshot.ruleVersion,
          chapterId: session.chapterId, completed: true,
        });
      });
    }),
  };
}

export type ProgressionApi = ReturnType<typeof createProgressionApi>;

/// Production wiring: identity comes from the managed session, content from
/// Axum, and the signing secret stays server-side. No header/env request bypass.
export async function wrapProgressionRoute(
  run: (api: ProgressionApi, request: Request) => Promise<Response>,
  request: Request,
): Promise<Response> {
  return withObservedRoute("progression", request, async () => {
    try {
      return await run(productionProgressionApi(), request);
    } catch (error) {
      return progressionErrorResponse(error);
    }
  });
}

export function productionProgressionApi(): ProgressionApi {
  return createProgressionApi({
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
    content: () => serverContent(),
    secret: () => readTicketSecret(),
  });
}
