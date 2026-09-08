/**
 * The Qapında mark.
 *
 * An open doorway with a delivery bag beside it — drawn as geometry rather than
 * an image file so it stays sharp at 24 px on a tab and at 512 px on a splash
 * screen, and so it can take the current text colour on a dark header.
 */

export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      className={className}
      role="img"
      aria-label="Qapında"
    >
      <circle
        cx="44.75"
        cy="50"
        r="30"
        fill="none"
        stroke="currentColor"
        strokeWidth="15"
      />
      <circle cx="66.25" cy="71.5" r="13" fill="currentColor" />
      <rect x="62.75" y="65" width="30" height="13" rx="6.5" fill="currentColor" />
    </svg>
  );
}

export function Logo({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <LogoMark size={size} className="text-brand-600" />
      <span className="text-[1.15rem] font-semibold tracking-tight text-ink-900">Qapında</span>
    </span>
  );
}
