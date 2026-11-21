"use client";

import { accountMutate } from "@/lib/account/client";

/// On-demand chapter check. Called when an authenticated reader opens the
/// library or notification center; the server dedupes and bounds the work.
export function refreshChapterNotifications(): Promise<{ checked: number; created: number; skipped: boolean }> {
  return accountMutate("/api/v1/notifications/refresh", "POST", {});
}
