export const AUTH_TOKEN_KEYS = [
  "credential",
  "id_token",
] as const;

// Google Identity Services normally returns the ID token in its JS callback;
// accept hash/query credentials too so sign-in links can complete on load.
export function authTokenParams(hash: string, search: string): URLSearchParams | null {
  const hashParams = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  if (AUTH_TOKEN_KEYS.some((key) => hashParams.has(key))) return hashParams;

  const queryParams = new URLSearchParams(search);
  if (AUTH_TOKEN_KEYS.some((key) => queryParams.has(key))) return queryParams;
  return null;
}
