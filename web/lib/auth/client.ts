"use client";

import { handleAuthCallback, login, oauthLogin, signup } from "@netlify/identity";

export async function signIn(email: string, password: string) {
  return login(email, password);
}

export async function signUp(email: string, password: string, name?: string) {
  return signup(email, password, name ? { data: { full_name: name } } : undefined);
}

export function signInWithGoogle(): void {
  oauthLogin("google");
}

// Sign-out goes through /api/auth/sign-out so the server clears the Identity
// cookies behind the route's Origin check; the adapter calls SDK logout there.
export { handleAuthCallback };
