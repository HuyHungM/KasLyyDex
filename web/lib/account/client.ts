"use client";

import { useCallback, useEffect, useSyncExternalStore, useState } from "react";
import { authClient } from "@/lib/auth/client";

export type AccountUser = {
  id: string;
  name: string | null;
  email: string | null;
  emailVerified: boolean;
  image: string | null;
};

export type SessionState = {
  status: "loading" | "guest" | "authenticated" | "unconfigured" | "error";
  user: AccountUser | null;
  message: string | null;
};

const LOADING: SessionState = { status: "loading", user: null, message: null };
const listeners = new Set<() => void>();
let snapshot: SessionState = LOADING;
let started = false;

function publish(next: SessionState): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function getSnapshot(): SessionState {
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export class AccountApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function parseAccountResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const error = payload?.error && typeof payload.error === "object"
      ? payload.error as { code?: string; message?: string }
      : null;
    throw new AccountApiError(
      response.status,
      error?.code ?? "REQUEST_FAILED",
      error?.message ?? "Yêu cầu không thành công.",
    );
  }
  return payload as T;
}

async function loadSession(): Promise<void> {
  try {
    const response = await fetch("/api/auth/get-session", { credentials: "same-origin", cache: "no-store" });
    if (response.status === 503) {
      const payload = await response.json().catch(() => null) as { error?: { code?: string } } | null;
      if (payload?.error?.code === "AUTH_NOT_CONFIGURED") {
        publish({
          status: "unconfigured",
          user: null,
          message: "Chưa cấu hình đăng nhập. Cần NEON_AUTH_BASE_URL và NEON_AUTH_COOKIE_SECRET trên máy chủ.",
        });
        return;
      }
      publish({ status: "error", user: null, message: "Dịch vụ xác thực tạm thời không sẵn sàng." });
      return;
    }
    const payload = await parseAccountResponse<{ user?: Record<string, unknown> | null }>(response);
    const user = payload.user;
    if (!user || typeof user.id !== "string") {
      publish({ status: "guest", user: null, message: null });
      return;
    }
    publish({
      status: "authenticated",
      user: {
        id: user.id,
        name: typeof user.name === "string" ? user.name : null,
        email: typeof user.email === "string" ? user.email : null,
        emailVerified: user.emailVerified === true,
        image: typeof user.image === "string" ? user.image : null,
      },
      message: null,
    });
  } catch {
    publish({ status: "error", user: null, message: "Không đọc được phiên đăng nhập." });
  }
}

export async function refreshSession(): Promise<SessionState> {
  await loadSession();
  return snapshot;
}

export function useAccountSession() {
  const state = useSyncExternalStore(subscribe, getSnapshot, () => LOADING);
  useEffect(() => {
    if (started) return;
    started = true;
    void loadSession();
  }, []);
  return { session: state, refresh: refreshSession };
}

export async function accountGet<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store" });
  return parseAccountResponse<T>(response);
}

export async function accountMutate<T>(path: string, method: "PUT" | "PATCH" | "POST" | "DELETE", body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parseAccountResponse<T>(response);
}

export type RemoteState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

/// Client-side fetch without setState directly in an effect: the async loader
/// is the only place that updates React state.
export function useRemoteResource<T>(path: string | null): RemoteState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await accountGet<T>(path));
      setError(null);
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : "Không tải được dữ liệu.");
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(async () => {
      if (alive) await load();
    });
    return () => { alive = false; };
  }, [load, revision]);

  return { data, loading, error, reload: () => setRevision((value) => value + 1) };
}

export async function signOutAccount(): Promise<void> {
  const result = await authClient.signOut();
  if (result?.error) throw new Error(result.error.message ?? "Không thể đăng xuất.");
  await refreshSession();
}
