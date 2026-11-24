"use client";

import Link from "next/link";
import { useState } from "react";
import { signIn, signInWithGoogle, signUp } from "@/lib/auth/client";
import { signOutAccount, useAccountSession } from "@/lib/account/client";

type Mode = "sign-in" | "sign-up";

export default function AuthPanel() {
  const { session, refresh } = useAccountSession();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (session.status === "loading") return <div className="surface account-card">Đang kiểm tra phiên đăng nhập…</div>;

  if (session.status === "unconfigured") {
    return (
      <div className="surface account-card" role="status">
        <h2>Chưa bật đăng nhập</h2>
        <p>{session.message}</p>
        <p className="account-hint">
          Bạn vẫn có thể đọc và lưu truyện ở chế độ khách trên thiết bị này. Không có phiên giả hoặc dữ liệu mẫu được tạo.
        </p>
      </div>
    );
  }

  if (session.status === "error") {
    return (
      <div className="surface account-card" role="alert">
        <h2>Không đọc được phiên đăng nhập</h2>
        <p>{session.message}</p>
        <button type="button" className="btn" onClick={() => void refresh()}>Thử lại</button>
      </div>
    );
  }

  if (session.status === "authenticated") {
    return (
      <div className="surface account-card">
        <h2>Đã đăng nhập</h2>
        <p className="account-hint">
          <strong>{session.user?.name ?? session.user?.email ?? "Tài khoản"}</strong>
          {session.user?.name && session.user.email ? ` · ${session.user.email}` : ""}
          {" · "}{session.user?.emailVerified ? "email đã xác thực" : "email chưa xác thực"}
        </p>
        <div className="actions">
          <Link href="/tai-khoan/cai-dat" className="btn">Cài đặt đọc</Link>
          <Link href="/tai-khoan/lich-su" className="btn">Lịch sử đọc</Link>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setMessage(null);
              try {
                await signOutAccount();
              } catch (error) {
                setMessage(error instanceof Error ? error.message : "Không thể đăng xuất.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Đang đăng xuất…" : "Đăng xuất"}
          </button>
        </div>
        {message ? <p className="account-error" role="alert">{message}</p> : null}
      </div>
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const user = mode === "sign-in"
        ? await signIn(email, password)
        : await signUp(email, password, name || email.split("@")[0]);
      if (!user) throw new Error("Đăng nhập thất bại.");
      await refresh();
      setPassword("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Đăng nhập thất bại.");
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setMessage(null);
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (error) {
      setBusy(false);
      setMessage(error instanceof Error ? error.message : "Google đăng nhập thất bại.");
    }
  }

  return (
    <div className="surface account-card">
      <div className="account-tabs" role="tablist" aria-label="Chế độ tài khoản">
        <button type="button" role="tab" aria-selected={mode === "sign-in"} className={mode === "sign-in" ? "active" : ""} onClick={() => setMode("sign-in")}>Đăng nhập</button>
        <button type="button" role="tab" aria-selected={mode === "sign-up"} className={mode === "sign-up" ? "active" : ""} onClick={() => setMode("sign-up")}>Đăng ký</button>
      </div>
      <form className="account-form" onSubmit={(event) => void submit(event)}>
        {mode === "sign-up" && (
          <label>Tên hiển thị
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} autoComplete="name" />
          </label>
        )}
        <label>Email
          <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
        </label>
        <label>Mật khẩu
          <input type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Đang gửi…" : mode === "sign-in" ? "Đăng nhập" : "Tạo tài khoản"}
        </button>
      </form>
      <button type="button" className="btn" disabled={busy} onClick={() => void google()}>
        {busy ? "Đang chuyển đến Google…" : "Tiếp tục với Google"}
      </button>
      {message ? <p className="account-error" role="alert">{message}</p> : null}
      <p className="account-hint">Sau khi xác thực ở Google, trang này sẽ tự động nhận phiên và hiển thị tài khoản của bạn.</p>
    </div>
  );
}
