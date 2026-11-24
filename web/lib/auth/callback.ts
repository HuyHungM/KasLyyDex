export const AUTH_TOKEN_KEYS = [
  "access_token",
  "confirmation_token",
  "recovery_token",
  "invite_token",
  "email_change_token",
] as const;

/// GoTrue normally returns OAuth/confirmation tokens in the URL hash. Some
/// Netlify callback paths leave them in the query string instead, so accept
/// both shapes and normalize to the hash form the browser SDK expects.
export function authTokenParams(hash: string, search: string): URLSearchParams | null {
  const hashParams = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  if (AUTH_TOKEN_KEYS.some((key) => hashParams.has(key))) return hashParams;

  const queryParams = new URLSearchParams(search);
  if (AUTH_TOKEN_KEYS.some((key) => queryParams.has(key))) return queryParams;
  return null;
}