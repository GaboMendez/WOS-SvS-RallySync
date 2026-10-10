const map: Record<string, string> = {
  ABS: "border-tag-abs text-tag-abs",
  WSE: "border-tag-wse text-tag-wse",
  GOS: "border-tag-gos text-tag-gos",
};
export function TagBadge({ tag }: { tag: string }) {
  return (
    <span className={`shrink-0 rounded border px-1 font-mono text-[10px] font-bold ${map[tag.toUpperCase()] ?? "border-muted-foreground text-muted-foreground"}`}>
      {tag || "—"}
    </span>
  );
}
