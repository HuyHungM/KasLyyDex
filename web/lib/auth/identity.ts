// The only bridge from a verified sign-in to application account data.
// The id is opaque and comes exclusively from a verified provider or D1 row.

export type AccountIdentity = {
  id: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  image: string | null;
  sessionId: string;
};

type Loose = Record<string, unknown>;

function obj(value: unknown): Loose {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Loose) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Sessions are signed server-side; a payload without a user is never accepted.
export function identityFromSession(data: unknown): AccountIdentity | null {
  const payload = obj(data);
  if (!payload.session || !payload.user) return null;
  const session = obj(payload.session);
  const user = obj(payload.user);
  const id = text(user.id);
  if (!id || id.length > 256) return null;
  return {
    id,
    email: text(user.email),
    emailVerified: user.emailVerified === true,
    name: text(user.name),
    image: text(user.image),
    sessionId: text(session.id) ?? "",
  };
}

// Google ID-token claims and D1 user rows both carry verified account fields.
// Privilege fields (role, app_metadata, level, xp) are deliberately ignored.
export function identityFromVerifiedUser(data: unknown): AccountIdentity | null {
  const user = obj(data);
  const id = text(user.id) ?? text(user.sub);
  if (!id || id.length > 256) return null;
  if (user.emailVerified === false || user.email_verified === false) return null;
  return {
    id,
    email: text(user.email),
    emailVerified: true,
    name: text(user.name) ?? text(user.full_name) ?? text(user.picture_name),
    image: text(user.image) ?? text(user.picture),
    sessionId: id,
  };
}
