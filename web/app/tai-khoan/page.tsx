import AccountPage from "@/components/account/AccountPage";

export const metadata = { title: "Tài khoản" };

export default function AccountRoute() {
  return (
    <main className="wrap catalog-page">
      <AccountPage />
    </main>
  );
}
