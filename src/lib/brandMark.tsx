/**
 * The Synapse mark, drawn for next/og's ImageResponse (Satori). Used for the
 * favicon, the iOS home-screen icon and the PWA manifest icons, so every size
 * comes from one source and there are no binary assets to keep in sync.
 *
 * `padded` leaves room for Android's maskable crop (the safe zone is the
 * centre 80%).
 */
export function BrandMark({ size, padded = false }: { size: number; padded?: boolean }) {
  const inner = padded ? size * 0.62 : size * 0.78;
  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(140deg, #141826 0%, #0b0d12 100%)',
        borderRadius: padded ? 0 : size * 0.22,
      }}
    >
      <svg width={inner} height={inner} viewBox="0 0 100 100">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#7c8cff" />
            <stop offset="100%" stopColor="#4dd4e8" />
          </linearGradient>
        </defs>
        <path
          d="M30 28 L68 40 M30 28 L40 72 M68 40 L40 72 M68 40 L80 76"
          stroke="url(#g)"
          strokeWidth="5"
          strokeLinecap="round"
          fill="none"
          opacity="0.75"
        />
        <circle cx="30" cy="28" r="11" fill="#7c8cff" />
        <circle cx="68" cy="40" r="14" fill="url(#g)" />
        <circle cx="40" cy="72" r="9" fill="#f2789e" />
        <circle cx="80" cy="76" r="6" fill="#4dd4e8" />
      </svg>
    </div>
  );
}
