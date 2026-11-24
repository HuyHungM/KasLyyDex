"use client";

import { useState } from "react";
import type { AccountProfileDto } from "@/lib/contracts";
import { accountMutate, useAccountSession, useRemoteResource } from "@/lib/account/client";

function ProfileFields({ profile, onSaved }: { profile: AccountProfileDto; onSaved: () => void }) {
  const [username, setUsername] = useState(profile.username ?? "");
  const [displayName, setDisplayName] = useState(profile.displayName ?? "");
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await accountMutate("/api/v1/me", "PATCH", {
        username: username.trim() || null,
        displayName: displayName.trim() || null,
        avatarUrl: avatarUrl.trim() || null,
      });
      setMessage("Đã lưu hồ sơ.");
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không lưu được hồ sơ.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={(event) => void submit(event)}>
      <label className="auth-field">
        <span>Tên người dùng</span>
        <input className="auth-input" value={username} onChange={(event) => setUsername(event.target.value)} maxLength={24} placeholder="3–24 ký tự a-z, 0-9, ., _" />
      </label>
      <label className="auth-field">
        <span>Tên hiển thị</span>
        <input className="auth-input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={60} placeholder="Tên bạn bè sẽ thấy" />
      </label>
      <label className="auth-field">
        <span>Ảnh đại diện (https)</span>
        <input className="auth-input" type="url" value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} maxLength={512} placeholder="https://…" />
      </label>
      <button type="submit" className="auth-submit" disabled={busy}>
        {busy ? "Đang lưu…" : "Lưu hồ sơ"}
        <span aria-hidden="true">→</span>
      </button>
      {message ? <p className={message.startsWith("Đã") ? "account-hint auth-foot" : "account-error"} role="status">{message}</p> : null}
    </form>
  );
}

export default function ProfileForm() {
  const { session } = useAccountSession();
  const remote = useRemoteResource<{ profile: AccountProfileDto }>(
    session.status === "authenticated" ? "/api/v1/me" : null,
    session.user?.id ?? "guest",
  );

  if (session.status !== "authenticated") return null;
  if (remote.loading && !remote.data) return <div className="surface account-card">Đang tải hồ sơ…</div>;
  if (remote.error || !remote.data) {
    return (
      <div className="surface account-card" role="alert">
        <p>{remote.error ?? "Không tải được hồ sơ."}</p>
        <button type="button" className="btn" onClick={remote.reload}>Thử lại</button>
      </div>
    );
  }
  const { profile } = remote.data;
  return (
    <div className="surface account-card">
      <p className="profile-folio">Trang 02 · Hồ sơ</p>
      <h2>Hồ sơ</h2>
      <p className="account-hint">
        Cấp {profile.level} · {profile.totalXp} XP — điểm kinh nghiệm chỉ là giá trị giữ chỗ cho đến khi ghi nhận hoàn thành chương.
      </p>
      <ProfileFields key={`${profile.id}:${profile.username ?? ""}:${profile.displayName ?? ""}`} profile={profile} onSaved={remote.reload} />
    </div>
  );
}
