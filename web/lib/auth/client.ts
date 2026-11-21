"use client";

import { createAuthClient } from "@neon/auth/next";

export const authClient = createAuthClient();

// Managed Better Auth owns provider configuration; Google credentials are set in
// the Neon branch, never in the browser bundle.
export function signInWithGoogle(callbackURL = "/") {
  return authClient.signIn.social({ provider: "google", callbackURL });
}
