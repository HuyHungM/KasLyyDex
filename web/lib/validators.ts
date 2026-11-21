// Browser-safe input boundary. Nothing here trusts client-supplied ids, roles,
// XP, levels or timestamps; callers derive identity from the managed session.

export type ReaderSettingsDto = {
  mode: "vertical" | "horizontal";
  fit: boolean;
  bg: "light" | "sepia" | "dark";
  speed: number;
};

export const DEFAULT_READER_SETTINGS: ReaderSettingsDto = {
  mode: "vertical",
  fit: true,
  bg: "light",
  speed: 3,
};

export const LIBRARY_STATUSES = ["reading", "planned", "completed", "paused", "dropped"] as const;
export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];

export class ValidationError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ValidationError";
    this.status = status;
    this.code = code;
  }
}

const MAX_ID = 200;
const MAX_TEXT = 300;
const MAX_IMPORT_ITEMS = 200;
const MAX_IMPORT_HISTORY = 100;
const MAX_JSON_BYTES = 24 * 1024;
const MAX_CLIENT_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_CLIENT_SKEW_MS = 5 * 60 * 1000;

function assertAllowedKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new ValidationError(400, "INVALID_INPUT", `Unexpected field: ${unknown[0]}`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function plainText(value: unknown, max = MAX_TEXT): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new ValidationError(400, "INVALID_INPUT", "Expected text.");
  const trimmed = value.trim();
  if (trimmed.length > max || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new ValidationError(400, "INVALID_INPUT", "Text is too long or contains control characters.");
  }
  return trimmed;
}

function requiredText(value: unknown, field: string, max = MAX_ID): string {
  const parsed = plainText(value, max);
  if (!parsed) throw new ValidationError(400, "INVALID_INPUT", `${field} is required.`);
  return parsed;
}

function optionalId(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = plainText(value, MAX_ID);
  if (!parsed || /[/?#]/.test(parsed)) return null;
  return parsed;
}

function integerIn(value: unknown, min: number, max: number, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError(400, "INVALID_INPUT", `${field} is out of range.`);
  }
  return value;
}

export function parseLanguage(value: unknown): string {
  if (value === undefined || value === null || value === "") return "vi";
  const parsed = plainText(value, 20) ?? "vi";
  if (!/^[A-Za-z][A-Za-z-]{1,19}$/.test(parsed)) {
    throw new ValidationError(400, "INVALID_INPUT", "Invalid language.");
  }
  return parsed;
}

/// Same-origin mutation guard. `Origin` must match the request's own host and
/// scheme, including forwarded headers in a platform deployment.
export function requireOrigin(request: Request): void {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return;
  const origin = request.headers.get("origin");
  if (!origin) throw new ValidationError(403, "ORIGIN_REJECTED", "Origin header is required.");
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = forwardedHost || url.host;
  const protocol = forwardedProto || url.protocol.replace(":", "");
  if (origin !== `${protocol}://${host}`) {
    throw new ValidationError(403, "ORIGIN_REJECTED", "Cross-origin mutation rejected.");
  }
}

export async function readJson(request: Request, maxBytes = MAX_JSON_BYTES): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(contentType)) {
    throw new ValidationError(415, "UNSUPPORTED_MEDIA_TYPE", "Expected application/json.");
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ValidationError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new ValidationError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ValidationError(400, "INVALID_JSON", "Request body is not valid JSON.");
  }
  if (!isObject(parsed)) throw new ValidationError(400, "INVALID_INPUT", "Expected a JSON object.");
  return parsed;
}

/// Client timestamps may annotate local history only. Reject nan/infinity,
/// ancient values and implausible future dates before they touch the database.
export function boundedClientTime(value: unknown, nowMs = Date.now()): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) return null;
  if (value < nowMs - MAX_CLIENT_AGE_MS || value > nowMs + MAX_CLIENT_SKEW_MS) return null;
  return value;
}

export function parseResourceId(value: unknown, field = "id"): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(400, "INVALID_INPUT", `${field} is required.`);
  }
  return requiredText(value, field, MAX_ID);
}

export function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9._]{3,24}$/.test(normalized) ? normalized : null;
}

export function parseProfilePatch(body: Record<string, unknown>): {
  username?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
} {
  assertAllowedKeys(body, ["username", "displayName", "avatarUrl"]);
  const patch: { username?: string | null; displayName?: string | null; avatarUrl?: string | null } = {};
  if (Object.hasOwn(body, "username")) {
    if (body.username === null || body.username === "") patch.username = null;
    else {
      const username = normalizeUsername(body.username);
      if (!username) throw new ValidationError(400, "INVALID_INPUT", "Username must be 3-24 letters, digits, dots or underscores.");
      patch.username = username;
    }
  }
  if (Object.hasOwn(body, "displayName")) {
    const displayName = plainText(body.displayName, 60);
    if (displayName === null && body.displayName !== null) {
      throw new ValidationError(400, "INVALID_INPUT", "Display name must be 1-60 characters.");
    }
    patch.displayName = displayName || null;
  }
  if (Object.hasOwn(body, "avatarUrl")) {
    const avatarUrl = plainText(body.avatarUrl, 512);
    if (avatarUrl !== null) {
      let parsed: URL;
      try {
        parsed = new URL(avatarUrl);
      } catch {
        throw new ValidationError(400, "INVALID_INPUT", "Avatar URL is invalid.");
      }
      if (parsed.protocol !== "https:" || !parsed.hostname) {
        throw new ValidationError(400, "INVALID_INPUT", "Avatar URL must be https.");
      }
    }
    patch.avatarUrl = avatarUrl || null;
  }
  return patch;
}

export type LibraryInput = {
  title: string;
  coverFile: string | null;
  lang: string;
  status: LibraryStatus;
};

export function parseLibraryInput(body: Record<string, unknown>): LibraryInput {
  assertAllowedKeys(body, ["title", "coverFile", "lang", "status"]);
  const title = requiredText(body.title, "title", 200);
  const coverFile = optionalId(body.coverFile);
  const lang = parseLanguage(body.lang);
  const status = body.status === undefined ? "reading" : plainText(body.status, 20);
  if (!status || !LIBRARY_STATUSES.includes(status as LibraryStatus)) {
    throw new ValidationError(400, "INVALID_INPUT", "Unknown library status.");
  }
  return { title, coverFile, lang, status: status as LibraryStatus };
}

export type ProgressInput = {
  mangaId: string;
  lang: string;
  page: number;
  total: number;
  chapter: string | null;
  title: string | null;
  coverFile: string | null;
};

export function parseProgressInput(body: Record<string, unknown>): ProgressInput {
  assertAllowedKeys(body, ["mangaId", "lang", "page", "total", "chapter", "title", "coverFile"]);
  const mangaId = parseResourceId(body.mangaId, "mangaId");
  const lang = parseLanguage(body.lang);
  const total = integerIn(body.total, 1, 10_000, "total");
  const page = integerIn(body.page, 1, 10_000, "page");
  if (page > total) throw new ValidationError(400, "INVALID_INPUT", "page cannot exceed total.");
  return {
    mangaId,
    lang,
    page,
    total,
    chapter: optionalId(body.chapter),
    title: plainText(body.title, 200),
    coverFile: optionalId(body.coverFile),
  };
}

export function parseSettingsInput(body: Record<string, unknown>): ReaderSettingsDto {
  assertAllowedKeys(body, ["mode", "fit", "bg", "speed"]);
  const mode = body.mode === undefined ? DEFAULT_READER_SETTINGS.mode : body.mode;
  const bg = body.bg === undefined ? DEFAULT_READER_SETTINGS.bg : body.bg;
  if (mode !== "vertical" && mode !== "horizontal") {
    throw new ValidationError(400, "INVALID_INPUT", "Unknown reader mode.");
  }
  if (bg !== "light" && bg !== "sepia" && bg !== "dark") {
    throw new ValidationError(400, "INVALID_INPUT", "Unknown reader background.");
  }
  if (body.fit !== undefined && typeof body.fit !== "boolean") {
    throw new ValidationError(400, "INVALID_INPUT", "fit must be a boolean.");
  }
  return {
    mode,
    fit: body.fit === undefined ? DEFAULT_READER_SETTINGS.fit : body.fit,
    bg,
    speed: body.speed === undefined ? DEFAULT_READER_SETTINGS.speed : integerIn(body.speed, 1, 5, "speed"),
  };
}

export type ImportLibraryItem = LibraryInput & { mangaId: string; followedAt: number };
export type ImportHistoryItem = {
  mangaId: string;
  chapterId: string;
  lang: string;
  page: number;
  total: number;
  chapter: string | null;
  title: string | null;
  coverFile: string | null;
  ts: number;
};

function importLibraryItem(value: unknown, nowMs: number): ImportLibraryItem | null {
  if (!isObject(value)) return null;
  const followedAt = boundedClientTime(value.followedAt, nowMs);
  let mangaId: string;
  try {
    mangaId = parseResourceId(
      typeof value.mangaId === "string" ? value.mangaId : undefined,
      "mangaId",
    );
  } catch {
    return null;
  }
  if (followedAt === null) return null;
  try {
    const input = parseLibraryInput({
      title: value.title ?? mangaId,
      coverFile: value.coverFile,
      lang: value.lang,
      status: value.status ?? "reading",
    });
    return { ...input, mangaId, followedAt };
  } catch {
    return null;
  }
}

function importHistoryItem(value: unknown, nowMs: number): ImportHistoryItem | null {
  if (!isObject(value)) return null;
  const ts = boundedClientTime(value.ts, nowMs);
  if (ts === null) return null;
  try {
    const input = parseProgressInput({
      mangaId: value.mangaId,
      lang: value.lang,
      page: value.page ?? 1,
      total: value.total ?? value.page ?? 1,
      chapter: value.chapter,
      title: value.title,
      coverFile: value.coverFile,
    });
    return { ...input, chapterId: "", ts } as ImportHistoryItem;
  } catch {
    return null;
  }
}

export function parseImportPayload(body: Record<string, unknown>, nowMs = Date.now()): {
  library: ImportLibraryItem[];
  history: (ImportHistoryItem & { chapterId: string })[];
  settings: ReaderSettingsDto | null;
  skipped: number;
  invalid: number;
} {
  assertAllowedKeys(body, ["library", "history", "settings"]);
  let skipped = 0;
  const arrays: Record<string, unknown[]> = {};
  for (const field of ["library", "history"] as const) {
    const value = body[field];
    if (value === undefined) arrays[field] = [];
    else if (!Array.isArray(value)) {
      throw new ValidationError(400, "INVALID_INPUT", `${field} must be an array.`);
    } else arrays[field] = value.slice(0, field === "library" ? MAX_IMPORT_ITEMS : MAX_IMPORT_HISTORY);
  }
  const library = arrays.library
    .map((item) => importLibraryItem(item, nowMs))
    .filter((item): item is ImportLibraryItem => {
      if (!item) skipped += 1;
      return item !== null;
    });

  // History entries need a chapter id, which is a path parameter in the
  // normal progress API but part of the local payload during an import.
  const history = arrays.history.flatMap((raw) => {
    if (!isObject(raw) || typeof raw.chapterId !== "string" || !raw.chapterId.trim()) {
      skipped += 1;
      return [];
    }
    const parsed = importHistoryItem(raw, nowMs);
    if (!parsed) {
      skipped += 1;
      return [];
    }
    return [{ ...parsed, chapterId: raw.chapterId.trim().slice(0, MAX_ID) }];
  });

  let settings: ReaderSettingsDto | null = null;
  if (body.settings !== undefined) {
    if (!isObject(body.settings)) throw new ValidationError(400, "INVALID_INPUT", "settings must be an object.");
    settings = parseSettingsInput(body.settings);
  }
  return { library, history, settings, skipped, invalid: skipped };
}

/// Explicit operator configuration only. A client never sends a role, and an
/// unverified email can never bootstrap one.
export function roleFromVerifiedAllowlist(
  identity: { email: string | null; emailVerified: boolean },
  allowlist: readonly string[],
): "admin" | null {
  if (!identity.emailVerified || !identity.email || allowlist.length === 0) return null;
  const allowed = new Set(allowlist.map((email) => email.trim().toLowerCase()).filter(Boolean));
  return allowed.has(identity.email.trim().toLowerCase()) ? "admin" : null;
}
