interface LogoProps {
  size?: number;
  className?: string;
}

/**
 * Floom mark: two horizontal flow bars stacked in a rounded square,
 * suggesting pipelines / layers / composition.
 * Monochrome, scales cleanly at 20-64px.
 */
export function FloomMark({ size = 32, className }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <rect x="7" y="10" width="14" height="3" rx="1.5" fill="white" />
      <rect x="7" y="16" width="18" height="3" rx="1.5" fill="white" />
      <rect x="7" y="22" width="10" height="3" rx="1.5" fill="white" />
    </svg>
  );
}

/**
 * Full wordmark: mark + "floom" text in tight tracking.
 */
export function FloomWordmark({ size = 32, className }: LogoProps) {
  const textSize = Math.round(size * 0.56);
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: Math.round(size * 0.3),
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <FloomMark size={size} />
      <span
        style={{
          fontSize: textSize,
          fontWeight: 700,
          letterSpacing: '-0.03em',
          lineHeight: 1,
          fontFamily: 'inherit',
        }}
      >
        floom
      </span>
    </span>
  );
}
