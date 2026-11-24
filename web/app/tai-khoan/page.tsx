import AccountPage from "@/components/account/AccountPage";

export const metadata = { title: "Tài khoản" };

export default function AccountRoute() {
  return (
    <main className="wrap catalog-page">
      <div className="page-intro account-intro">
        <div>
          <p className="auth-kicker">KasLyyDex / Account</p>
          <h1>Tài khoản</h1>
          <p>Đăng nhập bằng email/mật khẩu hoặc Google để đồng bộ tủ truyện và tiến độ đọc.</p>
        </div>
      </div>
      <AccountPage />
    </main>
  );
}
