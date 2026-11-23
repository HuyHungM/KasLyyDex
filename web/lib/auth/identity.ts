// The only bridge from a managed-auth session to application account data.
// The id is opaque and comes exclusively from the verified session response.

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

export function identityFromSession(data: unknown): AccountIdentity | null {
  const payload = obj(data);
  if (!payload.session || !payload.user) return null;
  const session = obj(payload.session);
  const user = obj(payload.user);
  const id = text(user.id);
  // An expired/invalid session has no user; never synthesize one.
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

// Netlify Identity exposes raw GoTrue fields and the normalized SDK fields.
// Only verified users map into app identity; roles and other privilege fields
// are deliberately never read.
export function identityFromNetlifyUser(data: unknown): AccountIdentity | null {
  const user = obj(data);
  const id = text(user.id);
  // An explicit unverified flag wins; confirmation metadata cannot upgrade it.
  const unverified = user.email_verified === false || user.emailVerified === false;
  const verified = !unverified && (user.email_verified === true
    || user.emailVerified === true
    || (typeof user.confirmedAt === "string" && user.confirmedAt.length > 0));
  if (!id || id.length > 256 || !verified) return null;
  const metadata = obj(user.user_metadata ?? user.userMetadata);
  return {
    id,
    email: text(user.email),
    emailVerified: true,
    name: text(metadata.full_name) ?? text(metadata.name) ?? text(user.name),
    image: text(metadata.avatar_url) ?? text(user.pictureUrl),
    sessionId: id,
  };
}
