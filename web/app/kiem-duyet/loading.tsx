import { ModerationSkeleton } from "@/components/loaders";

export default function Loading() {
  return (
    <main className="wrap">
      <ModerationSkeleton label="Đang tải hàng đợi" rows={4} />
    </main>
  );
}
