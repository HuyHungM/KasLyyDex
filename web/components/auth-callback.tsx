"use client";

import { useEffect, useState } from "react";
import { refreshSession } from "@/lib/account/client";
import { handleAuthCallback } from "@/lib/auth/client";

// Only Identity's own hash parameters are callbacks; plain anchors are not.
const AUTH_HASH = /^#(access_token|confirmation_token|recovery_token|invite_token|email_change_token)=/;

export default function AuthCallback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      const kind = hash.slice(1).split("=")[0] || "unknown";
      void fetch(`/api/auth/get-session?authdebug=${encodeURIComponent(kind)}`, { cache: "no-store" }).catch(() => {});
    }
    if (!AUTH_HASH.test(hash)) return;
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
