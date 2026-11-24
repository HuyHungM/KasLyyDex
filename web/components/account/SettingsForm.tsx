"use client";

import { useState } from "react";
import Select from "@/components/ui/Select";
import type { ReaderSettingsDto } from "@/lib/validators";
import { getSettings, saveSettings, type ReaderSettings } from "@/lib/guest";
import { accountMutate, useAccountSession, useRemoteResource } from "@/lib/account/client";

function SettingsFields({
  value,
  onSave,
}: {
  value: ReaderSettingsDto;
  onSave: (next: ReaderSettingsDto) => Promise<string>;
}) {
  const [mode, setMode] = useState(value.mode);
  const [bg, setBg] = useState(value.bg);
  const [fit, setFit] = useState(value.fit);
  const [speed, setSpeed] = useState(value.speed);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await onSave({ mode, bg, fit, speed }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không lưu được cài đặt.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={(event) => void submit(event)}>
      <label className="auth-field">
        <span>Chế độ đọc</span>
        <Select
          ariaLabel="Chế độ đọc"
          value={mode}
          options={[
            { value: "vertical", label: "Cuộn dọc" },
            { value: "horizontal", label: "Chuyển trang" },
          ]}
          onChange={(value) => setMode(value as ReaderSettingsDto["mode"])}
        />
      </label>
      <label className="auth-field">
        <span>Nền</span>
        <Select
          ariaLabel="Nền"
          value={bg}
          options={[
            { value: "auto", label: "Tự động theo giao diện" },
            { value: "light", label: "Sáng" },
            { value: "sepia", label: "Ngà" },
            { value: "dark", label: "Tối" },
          ]}
          onChange={(value) => setBg(value as ReaderSettingsDto["bg"])}
        />
      </label>
      <label className="auth-check"><input type="checkbox" checked={fit} onChange={(event) => setFit(event.target.checked)} /> Vừa khung hình</label>
      <label className="auth-field">
        <span>Tốc độ cuộn</span>
        <input className="auth-input" type="number" min={1} max={5} value={speed} onChange={(event) => setSpeed(Number(event.target.value))} />
      </label>
      <button type="submit" className="auth-submit" disabled={busy}>
        {busy ? "Đang lưu…" : "Lưu cài đặt"}
        <span aria-hidden="true">→</span>
      </button>
      {message ? <p className="account-hint auth-foot" role="status">{message}</p> : null}
    </form>
  );
}

function GuestSettings() {
  const [settings, setSettings] = useState<ReaderSettingsDto>(() => getSettings() as ReaderSettingsDto);
  return (
    <div className="surface account-card">
      <h2>Cài đặt đọc</h2>
      <p className="account-hint">Chế độ khách: cài đặt chỉ lưu trên thiết bị này. Đăng nhập để đồng bộ giữa các máy.</p>
      <SettingsFields key="guest" value={settings} onSave={async (next) => {
        saveSettings(next as ReaderSettings);
        setSettings(next);
        return "Đã lưu trên thiết bị này.";
      }} />
    </div>
  );
}

export default function SettingsForm() {
  const { session } = useAccountSession();
  const remote = useRemoteResource<ReaderSettingsDto>(
    session.status === "authenticated" ? "/api/v1/me/settings" : null,
    session.user?.id ?? "guest",
  );

  if (session.status === "loading") return <div className="surface account-card">Đang kiểm tra phiên đăng nhập…</div>;
  if (session.status !== "authenticated") return <GuestSettings />;
  if (remote.loading && !remote.data) return <div className="surface account-card">Đang tải cài đặt…</div>;
  if (remote.error || !remote.data) {
    return (
      <div className="surface account-card" role="alert">
        <p>{remote.error ?? "Không tải được cài đặt."}</p>
        <button type="button" className="btn" onClick={remote.reload}>Thử lại</button>
      </div>
    );
  }
  return (
    <div className="surface account-card">
      <h2>Cài đặt đọc</h2>
      <p className="account-hint">Cài đặt được lưu trong tài khoản và áp dụng lại khi mở truyện trên thiết bị khác.</p>
      <SettingsFields key="server" value={remote.data} onSave={async (next) => {
        await accountMutate("/api/v1/me/settings", "PUT", next);
        remote.reload();
        return "Đã lưu vào tài khoản.";
      }} />
    </div>
  );
}
