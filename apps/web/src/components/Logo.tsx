interface LogoProps {
  size?: number;
  className?: string;
  withWordmark?: boolean;
}

export function Logo({ size = 20, className = '', withWordmark = false }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Floom"
      >
        <path
          d="M10 6 Q4 6 4 12 L4 36 Q4 42 10 42 L28 42 L44 24 L28 6 Z"
          fill="currentColor"
        />
      </svg>
      {withWordmark && <span className="font-semibold">floom</span>}
    </span>
  );
}

// Keep backward-compat exports used in other files
export function FloomMark({ size = 32, className }: { size?: number; className?: string }) {
  return <Logo size={size} className={className} />;
}

export function FloomWordmark({ size = 32, className }: { size?: number; className?: string }) {
  return <Logo size={size} className={className} withWordmark />;
}
