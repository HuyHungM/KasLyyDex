"use client";

import { refreshSession } from "@/lib/account/client";
import { authTokenParams } from "./callback";

type GoogleCredentialResponse = { credential?: string };
type GoogleId = {
  initialize: (options: Record<string, unknown>) => void;
  prompt: () => void;
};

declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

const SCRIPT_URL = "https://accounts.google.com/gsi/client";
let scriptPromise: Promise<void> | undefined;

function loadGoogleScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Google sign-in needs a browser."));
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_URL;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Could not load Google sign-in."));
      document.head.append(script);
    });
  }
  return scriptPromise;
}

async function postCredential(credential: string): Promise<void> {
  const response = await fetch("/api/auth/callback", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", origin: window.location.origin },
    body: JSON.stringify({ credential }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(payload?.error?.message ?? "Google sign-in failed.");
  }
  await refreshSession();
}

export async function signInWithGoogle(): Promise<void> {
  const configResponse = await fetch("/api/auth/config", { credentials: "same-origin", cache: "no-store" });
  const config = await configResponse.json().catch(() => null) as { googleClientId?: string | null } | null;
  if (!config?.googleClientId) throw new Error("Google sign-in is not configured.");
  await loadGoogleScript();
  return new Promise<void>((resolve, reject) => {
    window.google!.accounts.id.initialize({
      client_id: config.googleClientId,
      ux_mode: "popup",
      callback: (result: GoogleCredentialResponse) => {
        if (!result.credential) {
          reject(new Error("Google did not return a credential."));
          return;
        }
        void postCredential(result.credential).then(resolve, reject);
      },
    });
    window.google!.accounts.id.prompt();
  });
}

export async function signIn(email: string, password: string): Promise<unknown> {
  const response = await fetch("/api/auth/sign-in", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", origin: window.location.origin },
    body: JSON.stringify({ email, password }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message ?? "Đăng nhập thất bại.");
  return payload?.user ?? null;
}

export async function signUp(email: string, password: string, name?: string): Promise<unknown> {
  const response = await fetch("/api/auth/sign-up", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", origin: window.location.origin },
    body: JSON.stringify({ email, password, name }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message ?? "Đăng ký thất bại.");
  return payload?.user ?? null;
}

// Some callback links carry the Google credential in a hash or query string.
export async function handleAuthCallback(): Promise<unknown> {
  const params = authTokenParams(window.location.hash, window.location.search);
  const credential = params?.get("id_token") ?? params?.get("credential");
  if (!credential) return null;
  await postCredential(credential);
  window.history.replaceState(null, "", window.location.pathname);
  return refreshSession();
}
