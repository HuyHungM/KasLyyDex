"use client";

import { useEffect, useState } from "react";
import { refreshSession } from "@/lib/account/client";
import { authTokenParams } from "@/lib/auth/callback";
import { handleAuthCallback } from "@/lib/auth/client";

export default function AuthCallback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = authTokenParams(window.location.hash, window.location.search);
    if (!params) return;

    // The browser SDK reads the hash only; normalize query-token callbacks.
    if (!window.location.hash) {
      window.history.replaceState(null, "", `${window.location.pathname}#${params.toString()}`);
    }

    const kind = params.keys().next().value ?? "unknown";
    void fetch(`/api/auth/get-session?authdebug=${encodeURIComponent(kind)}`, { cache: "no-store" }).catch(() => {});

    let active = true;
    void (async () => {
      try {
        await handleAuthCallback();
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Không xử lý được liên kết xác thực.");
      } finally {
        await refreshSession();
      }
    })();
    return () => { active = false; };
  }, []);

  if (!error) return null;
  return (
    <div className="surface account-card" role="alert">
      <h2>Xác thực không thành công</h2>
      <p>{error}</p>
    </div>
  );
}
