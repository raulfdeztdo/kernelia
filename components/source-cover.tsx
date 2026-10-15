/**
 * Designed cover for articles that ship without an image, or whose image
 * fails to load. Instead of looking like a missing-asset placeholder (the
 * old radial-gradient + sparkles), it shows the publication name in large
 * typography over the category accent, so every card reads as intentional.
 */
export function SourceCover({
  accent,
  sourceName,
  categoryLabel,
}: {
  accent: string;
  sourceName: string;
  categoryLabel: string | null;
}) {
  return (
    <div
      aria-hidden
      className="relative flex h-full w-full flex-col justify-between p-5"
      style={{
        background: [
          // Top-left accent wash.
          `radial-gradient(circle at 15% 0%, color-mix(in oklch, ${accent} 55%, transparent) 0%, transparent 60%)`,
          // Bottom-right depth.
          `radial-gradient(circle at 100% 100%, color-mix(in oklch, ${accent} 22%, transparent) 0%, transparent 50%)`,
          // Base.
          `linear-gradient(135deg, var(--color-surface-2), var(--color-surface))`,
        ].join(", "),
      }}
    >
      {/* Subtle inner border so the card edge stays crisp. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-none ring-1 ring-white/5 ring-inset"
      />

      {categoryLabel && (
        <span
          className="z-10 text-[10px] font-semibold tracking-[0.18em] text-[color:var(--color-foreground)]/70 uppercase"
          style={{ color: accent }}
        >
          {categoryLabel}
        </span>
      )}

      <span
        className="z-10 mt-auto text-2xl leading-tight font-bold tracking-tight text-[color:var(--color-foreground)]/90 sm:text-[1.7rem]"
        style={{
          fontFeatureSettings: '"ss01"',
        }}
      >
        {sourceName}
      </span>
    </div>
  );
}
