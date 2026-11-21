// Browser-safe progression contract. Cosmetic only: no role or permission is
// derived from XP or cultivation level. Mirrors crates/domain CultivationRealm.

export const PROGRESSION_RULE_VERSION = "progression_v1";
export const XP_PER_CHAPTER = 100;
export const READER_TICKET_TTL_SECONDS = 30 * 60;
export const CHECKPOINT_WINDOW_MS = 60_000;
export const CHECKPOINT_LIMIT = 20;
export const MAX_PAGE_COUNT = 10_000;

export type Realm = {
  key: string;
  min: number;
  max: number;
  name: string;
};

// Exact 13 ranges from the approved platform spec (section 8).
export const REALMS: readonly Realm[] = [
  { key: "mortal", min: 1, max: 9, name: "Phàm Nhân" },
  { key: "qi_refining", min: 10, max: 49, name: "Luyện Khí" },
  { key: "foundation_establishment", min: 50, max: 99, name: "Trúc Cơ" },
  { key: "golden_core", min: 100, max: 199, name: "Kim Đan" },
  { key: "nascent_soul", min: 200, max: 299, name: "Nguyên Anh" },
  { key: "spirit_severing", min: 300, max: 399, name: "Hóa Thần" },
  { key: "void_refinement", min: 400, max: 499, name: "Luyện Hư" },
  { key: "body_integration", min: 500, max: 599, name: "Hợp Thể" },
  { key: "mahayana", min: 600, max: 699, name: "Đại Thừa" },
  { key: "tribulation_transcendence", min: 700, max: 799, name: "Độ Kiếp" },
  { key: "true_immortal", min: 800, max: 899, name: "Chân Tiên" },
  { key: "immortal_king", min: 900, max: 999, name: "Tiên Vương" },
  { key: "immortal_emperor", min: 1000, max: 1000, name: "Tiên Đế" },
];

export function clampTotalXp(totalXp: number): number {
  if (!Number.isFinite(totalXp)) return 0;
  return Math.max(0, Math.floor(totalXp));
}

export function levelFromXp(totalXp: number): number {
  return Math.min(1000, 1 + Math.floor(clampTotalXp(totalXp) / 200));
}

export function realmForLevel(level: number): Realm {
  const bounded = Math.min(1000, Math.max(1, Math.floor(level)));
  return REALMS.find((realm) => bounded >= realm.min && bounded <= realm.max) ?? REALMS[0];
}

export function progressionForXp(totalXp: number): {
  level: number;
  totalXp: number;
  realm: Realm;
  title: string;
  ruleVersion: string;
} {
  const xp = clampTotalXp(totalXp);
  const level = levelFromXp(xp);
  const realm = realmForLevel(level);
  return { level, totalXp: xp, realm, title: realm.name, ruleVersion: PROGRESSION_RULE_VERSION };
}

/// Authoritative page threshold: 80% of the server-observed image count.
export function requiredPages(pageCount: number): number {
  if (!Number.isInteger(pageCount) || pageCount < 1) return 1;
  return Math.min(pageCount, Math.ceil(pageCount * 0.8));
}

/// Anti-farm floor, not proof of human reading: max(10s, 2s per required page).
export function minimumElapsedMs(pageCount: number): number {
  return Math.max(10_000, requiredPages(pageCount) * 2_000);
}

/// Distinct, in-range visited pages only. Never returns "everything up to N".
export function mergePages(
  current: readonly number[],
  additions: readonly number[],
  pageCount: number,
): number[] {
  const seen = new Set<number>();
  for (const page of current) {
    if (Number.isInteger(page) && page >= 1 && page <= pageCount) seen.add(page);
  }
  for (const page of additions) {
    if (Number.isInteger(page) && page >= 1 && page <= pageCount) seen.add(page);
  }
  return [...seen].sort((a, b) => a - b);
}
