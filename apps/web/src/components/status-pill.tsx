type StatusTone = "online" | "offline" | "neutral";

export function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: StatusTone;
}) {
  const toneClass =
    tone === "online"
      ? "border border-emerald-100 bg-emerald-100 text-emerald-800"
      : tone === "offline"
        ? "border border-stone-300 bg-amber-100 text-amber-900"
        : "border border-stone-300 bg-stone-200 text-stone-700";

  return (
    <span
      className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium tracking-[0.18em] uppercase ${toneClass}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {label}
    </span>
  );
}
