import type { Metadata } from "next";
import ModerationQueue from "@/components/moderation/ModerationQueue";

export const metadata: Metadata = { title: "Kiểm duyệt" };

export default function ModerationPage() {
  return (
    <main className="wrap">
      <ModerationQueue />
    </main>
  );
}
