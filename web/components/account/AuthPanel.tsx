"use client";

import Link from "next/link";
import { useState } from "react";
import { signIn, signInWithGoogle, signUp } from "@/lib/auth/client";
import { signOutAccount, useAccountSession } from "@/lib/account/client";
import { AuthSkeleton } from "@/components/loaders";

type Mode = "sign-in" | "sign-up";

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.8 2.5 30.3.5 24 .5 14.6.5 6.5 6 2.6 14.6l7.8 6.1C12.3 14.1 17.6 9.5 24 9.5Z" />
      <path fill="#4285F4" d="M46.1 24.6c0-1.6-.2-3.2-.5-4.6H24v9.1h12.4c-.5 2.9-2.2 5.4-4.7 7.1l7.6 5.9c4.4-4.1 6.8-10.2 6.8-17.5Z" />
      <path fill="#FBBC05" d="M10.4 28.3c-.5-1.5-.8-3.1-.8-4.8s.3-3.3.8-4.8l-7.8-6.1C.9 16 0 19.9 0 24s.9 8 2.6 11.4l7.8-7.1Z" />
      <path fill="#34A853" d="M24 47.5c6.3 0 11.8-2.1 15.7-5.7l-7.6-5.9c-2.1 1.4-4.8 2.3-8.1 2.3-6.4 0-11.7-4.6-13.6-10.7l-7.8 6.1C6.5 42 14.6 47.5 24 47.5Z" />
    </svg>
  );
}

function AuthState({ eyebrow, title, children }: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="auth-shell auth-shell--state" aria-label={title}>
      <div className="auth-aside">
        <p className="auth-kicker">KasLyyDex / Member access</p>
        <h2 className="auth-title">{title}</h2>
        <p className="auth-quote">{eyebrow}</p>
      </div>
      <div className="auth-main">{children}</div>
    </section>
  );
}

export default function AuthPanel() {
  const { session, refresh } = useAccountSession();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (session.status === "loading") {
    return <AuthSkeleton />;
  }

  if (session.status === "unconfigured") {
    return (
      <AuthState eyebrow="Dịch vụ xác thực chưa sẵn sàng." title="Chưa bật đăng nhập">
        <p className="account-hint">{session.message}</p>
        <p className="account-hint">Bạn vẫn có thể đọc và lưu truyện ở chế độ khách trên thiết bị này.</p>
      </AuthState>
    );
  }

  if (session.status === "error") {
    return (
      <AuthState eyebrow="Phiên không đọc được, thử lại là khớp ngay." title="Không đọc được phiên">
        <p className="account-hint">{session.message}</p>
        <button type="button" className="auth-submit" onClick={() => void refresh()}>Thử lại</button>
      </AuthState>
    );
  }

  if (session.status === "authenticated") {
    const label = session.user?.name ?? session.user?.email ?? "Tài khoản";
    return (
      <section className="auth-shell" aria-label="Tài khoản">
        <div className="auth-aside">
          <div>
            <p className="auth-kicker">Đã vào thư viện</p>
            <h2 className="auth-title">Chào bạn,<br />{label}</h2>
          </div>
          <span className="auth-mark" aria-hidden="true">{label.slice(0, 1).toUpperCase()}</span>
          <p className="auth-quote">Lịch sử đọc và điểm của bạn đã được đồng bộ.</p>
        </div>
        <div className="auth-main">
          <p className="auth-eyebrow">Phiên hiện tại</p>
          <h3 className="auth-heading">Đã đăng nhập</h3>
          <p className="account-hint">
            {session.user?.email ?? "Tài khoản"} · {session.user?.emailVerified ? "email đã xác thực" : "email chưa xác thực"}
          </p>
          <div className="auth-actions">
            <Link href="/tai-khoan/cai-dat" className="btn">Cài đặt đọc</Link>
            <Link href="/tai-khoan/lich-su" className="btn">Lịch sử đọc</Link>
            <button
              type="button"
              className="auth-ghost"
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
      </section>
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

  const signingIn = mode === "sign-in";

  return (
    <section className="auth-shell" aria-label={signingIn ? "Đăng nhập" : "Đăng ký tài khoản"}>
      <div className="auth-aside">
        <div>
          <p className="auth-kicker">KasLyyDex / Member access</p>
          <h2 className="auth-title">
            {signingIn ? <>Trở lại<br />đọc tiếp.</> : <>Ghi danh<br />vào hội.</>}
          </h2>
        </div>
        <span className="auth-mark" aria-hidden="true">{signingIn ? "↗" : "✳"}</span>
        <p className="auth-quote">
          {signingIn
            ? "Đồng bộ trang đã đọc, tủ truyện và điểm trên mọi thiết bị."
            : "Tạo một chỗ để lưu truyện, theo dõi tiến độ và nhận điểm đọc."}
        </p>
      </div>

      <div className="auth-main">
        <div className="auth-switch" role="tablist" aria-label="Chế độ tài khoản">
          <button type="button" role="tab" aria-selected={signingIn} className={signingIn ? "active" : ""} onClick={() => { setMode("sign-in"); setMessage(null); }}>Đăng nhập</button>
          <button type="button" role="tab" aria-selected={!signingIn} className={!signingIn ? "active" : ""} onClick={() => { setMode("sign-up"); setMessage(null); }}>Đăng ký</button>
        </div>

        <p className="auth-eyebrow">{signingIn ? "Chào lại bạn" : "Bắt đầu thôi"}</p>
        <h3 className="auth-heading">{signingIn ? "Đăng nhập" : "Tạo tài khoản"}</h3>

        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          {!signingIn && (
            <label className="auth-field">
              <span>Tên hiển thị</span>
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} autoComplete="name" placeholder="Tên bạn muốn hiện" />
            </label>
          )}
          <label className="auth-field">
            <span>Email</span>
            <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="ban@example.com" />
          </label>
          <label className="auth-field">
            <span>Mật khẩu</span>
            <input type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={signingIn ? "current-password" : "new-password"} placeholder="Ít nhất 8 ký tự" />
          </label>
          <button type="submit" className="auth-submit" disabled={busy}>
            {busy ? "Đang gửi…" : signingIn ? "Đăng nhập" : "Tạo tài khoản"}
            <span aria-hidden="true">→</span>
          </button>
        </form>

        <div className="auth-divider"><span>hoặc</span></div>

        <button type="button" className="auth-google" disabled={busy} onClick={() => void google()}>
          <GoogleMark />
          {busy ? "Đang chuyển đến Google…" : "Tiếp tục với Google"}
        </button>

        {message ? <p className="account-error" role="alert">{message}</p> : null}
        <p className="account-hint auth-foot">
          Mật khẩu được lưu dưới dạng băm trên D1. Google đăng nhập qua xác thực ID token.
        </p>
      </div>
    </section>
  );
}
