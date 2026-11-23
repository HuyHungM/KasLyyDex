"use client";

import { useEffect, useRef, useSyncExternalStore, useState } from "react";
import { RemoteResourceController } from "@/lib/account/resource";

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
          message: "Chưa cấu hình đăng nhập. Cần bật Netlify Identity cho site này.",
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

export async function accountGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", signal });
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

/// Client-side fetch with a generation guard: a stale/key-switched response
/// can never write into the current account's state.
export function useRemoteResource<T>(path: string | null, identityKey = ""): RemoteState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const controller = useRef(new RemoteResourceController<T>());
  const key = `${identityKey}|${path ?? ""}`;

  useEffect(() => {
    const current = controller.current;
    const abort = new AbortController();
    const started = current.begin(key);
    // setState never runs synchronously in the effect body, and every update
    // after the await is gated by the current generation.
    void Promise.resolve().then(async () => {
      if (started.generation !== current.currentGeneration) return;
      setData(started.snapshot.data);
      setLoading(started.snapshot.loading);
      setError(started.snapshot.error);
      if (!path) return;
      try {
        const result = await accountGet<T>(path, abort.signal);
        const next = current.resolve(started.generation, result);
        if (next) {
          setData(next.data);
          setLoading(next.loading);
          setError(next.error);
        }
      } catch (cause) {
        if (abort.signal.aborted) return;
        const next = current.reject(started.generation, cause instanceof Error ? cause.message : "Không tải được dữ liệu.");
        if (next) {
          setData(next.data);
          setLoading(next.loading);
          setError(next.error);
        }
      }
    });
    return () => {
      abort.abort();
      current.dispose();
    };
  }, [key, path, revision]);

  return { data, loading, error, reload: () => setRevision((value) => value + 1) };
}

export async function signOutAccount(): Promise<void> {
  await accountMutate("/api/auth/sign-out", "POST");
  await refreshSession();
}
