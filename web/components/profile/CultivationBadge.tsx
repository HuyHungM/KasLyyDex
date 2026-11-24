"use client";

import { useRemoteResource } from "@/lib/account/client";

type LevelDto = {
  level: number;
  totalXp: number;
  title: string;
  realm: string;
  source: string;
  ruleVersion: string;
};

/// Cosmetic cultivation label. All values come from the server; no client
/// state or local import can raise the level or a permission.
export default function CultivationBadge() {
  const { data, loading, error } = useRemoteResource<LevelDto>("/api/v1/me/level");
  if (loading && !data) return <div className="cultivation-badge" aria-busy="true">Đang tải tu vi…</div>;
  if (error || !data) {
    return <div className="cultivation-badge" role="status">Chưa tải được tu vi.</div>;
  }
  return (
    <div className="cultivation-badge" aria-live="polite" data-realm={data.realm}>
      <p className="profile-folio">Trang 01 · Tu vi</p>
      <span className="cultivation-realm">{data.title}</span>
      <span className="cultivation-level">Cấp {data.level}</span>
      <span className="cultivation-xp">{data.totalXp} XP</span>
    </div>
  );
}
