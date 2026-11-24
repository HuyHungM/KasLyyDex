"use client";

import AuthPanel from "@/components/account/AuthPanel";
import ProfileForm from "@/components/account/ProfileForm";
import GuestImportPanel from "@/components/account/GuestImportPanel";
import CultivationBadge from "@/components/profile/CultivationBadge";
import { useAccountSession } from "@/lib/account/client";

export default function AccountPage() {
  const { session } = useAccountSession();
  const signedIn = session.status === "authenticated";

  return (
    <div className="volume">
      <header className="volume-masthead">
        <p className="volume-kicker">KasLyyDex · Tập 01</p>
        <h1>Tài khoản</h1>
        <p className="volume-sub">Đăng nhập bằng email/mật khẩu hoặc Google để đồng bộ tủ truyện và tiến độ đọc.</p>
      </header>

      <div className="volume-cover"><AuthPanel /></div>

      {signedIn ? (
        <ol className="volume-toc">
          <li className="toc-row">
            <span className="toc-no">01</span>
            <div className="toc-body"><CultivationBadge /></div>
            <span className="toc-label">Tu vi</span>
          </li>
          <li className="toc-row">
            <span className="toc-no">02</span>
            <div className="toc-body"><ProfileForm /></div>
            <span className="toc-label">Hồ sơ</span>
          </li>
          <li className="toc-row">
            <span className="toc-no">03</span>
            <div className="toc-body"><GuestImportPanel /></div>
            <span className="toc-label">Dữ liệu khách</span>
          </li>
        </ol>
      ) : null}
    </div>
  );
}
