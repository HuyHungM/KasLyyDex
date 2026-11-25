import { sourceLabel } from "@/lib/contracts";

export function SourceBadge({ source }: { source?: string }) {
  if (source !== "mangadex") return null;
  const label = sourceLabel(source);
  return <span className="source-badge" role="img" aria-label={`Nguồn: ${label}`}>{label}</span>;
}
