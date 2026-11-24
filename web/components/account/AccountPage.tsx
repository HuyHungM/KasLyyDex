"use client";

import AuthPanel from "@/components/account/AuthPanel";
import ProfileForm from "@/components/account/ProfileForm";
import GuestImportPanel from "@/components/account/GuestImportPanel";
import CultivationBadge from "@/components/profile/CultivationBadge";
import { useAccountSession } from "@/lib/account/client";

export default function AccountPage() {
  const { session } = useAccountSession();
  return (
    <div className={`account-grid${session.status === "authenticated" ? " account-grid--comic" : ""}`}>
      {session.status === "authenticated" ? (
        <>
          <section className="comic-panel comic-panel--head">
            <span className="chapter-mark">CH.00 / Thư viện</span>
            <AuthPanel />
          </section>
          <section className="comic-panel comic-panel--identity">
            <span className="chapter-mark">CH.01 / Tu vi</span>
            <CultivationBadge />
          </section>
          <section className="comic-panel comic-panel--form">
            <span className="chapter-mark">CH.02 / Hồ sơ</span>
            <ProfileForm />
          </section>
          <section className="comic-panel comic-panel--import">
            <span className="chapter-mark">CH.03 / Dữ liệu khách</span>
            <GuestImportPanel />
          </section>
        </>
      ) : <AuthPanel />}
    </div>
  );
}
