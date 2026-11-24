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
          <CultivationBadge />
          <ProfileForm />
          <GuestImportPanel />
        </>
      ) : null}
    </div>
  );
}
