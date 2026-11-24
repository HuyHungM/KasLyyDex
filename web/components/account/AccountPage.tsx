"use client";

import AuthPanel from "@/components/account/AuthPanel";
import ProfileForm from "@/components/account/ProfileForm";
import GuestImportPanel from "@/components/account/GuestImportPanel";
import CultivationBadge from "@/components/profile/CultivationBadge";
import { useAccountSession } from "@/lib/account/client";

export default function AccountPage() {
  const { session } = useAccountSession();
  return (
    <div className={`account-grid${session.status === "authenticated" ? " account-grid--full" : ""}`}>
      <AuthPanel />
      {session.status === "authenticated" ? (
        <>
          <div className="profile-spread">
            <div className="profile-page profile-page--left"><CultivationBadge /></div>
            <div className="profile-page profile-page--right"><ProfileForm /></div>
          </div>
          <GuestImportPanel />
        </>
      ) : null}
    </div>
  );
}
