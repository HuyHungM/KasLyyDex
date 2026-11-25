import PublicProfile from "@/components/profile/PublicProfile";

export const metadata = { title: "Hồ sơ thành viên" };

export default async function PublicProfileRoute({ params }: { params: Promise<{ userId: string }> }) {
  const { userId: encodedUserId } = await params;
  let userId = encodedUserId;
  try { userId = decodeURIComponent(encodedUserId); } catch { /* keep the opaque id */ }
  return (
    <main className="wrap catalog-page">
      <PublicProfile userId={userId} />
    </main>
  );
}
