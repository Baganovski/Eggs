function IconFrame({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 64 64" className="rule-icon" aria-hidden="true">
      {children}
    </svg>
  );
}

export function IconHp() {
  return (
    <IconFrame>
      <circle cx="32" cy="32" r="22" fill="none" />
      <path
        className="is-solid"
        d="M32 44c-8-6-14-11-14-18a8 8 0 0 1 14-5 8 8 0 0 1 14 5c0 7-6 12-14 18z"
      />
    </IconFrame>
  );
}

export function IconWalk() {
  return (
    <IconFrame>
      <path d="M20 44 L32 20 L44 44" fill="none" />
      <path d="M26 36 H38" fill="none" />
      <circle className="is-solid" cx="32" cy="16" r="4" />
    </IconFrame>
  );
}

export function IconShoot() {
  return (
    <IconFrame>
      <circle cx="32" cy="32" r="10" fill="none" />
      <circle className="is-solid" cx="32" cy="32" r="3" />
      <path d="M32 12 V20 M32 44 V52 M12 32 H20 M44 32 H52" fill="none" />
    </IconFrame>
  );
}

export function IconSync() {
  return (
    <IconFrame>
      <rect x="16" y="18" width="22" height="16" rx="3" fill="none" />
      <rect x="26" y="28" width="22" height="16" rx="3" fill="none" />
    </IconFrame>
  );
}
