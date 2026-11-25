import PublicProfile from "@/components/profile/PublicProfile";

export const metadata = { title: "Hồ sơ thành viên" };

export default async function PublicProfileRoute({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return (
    <main className="wrap catalog-page">
      <PublicProfile userId={userId} />
    </main>
  );
}
