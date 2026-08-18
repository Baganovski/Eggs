interface JoinCodeBarProps {
  code: string;
  onLeave: () => void;
}

export function JoinCodeBar({ code, onLeave }: JoinCodeBarProps) {
  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Clipboard may be unavailable on some mobile browsers.
    }
  };

  return (
    <header className="join-code-bar">
      <div className="join-code-copy">
        <span className="join-code-label">Join code</span>
        <button type="button" className="join-code-value" onClick={copyCode}>
          {code}
        </button>
      </div>
      <button type="button" className="btn btn-ghost" onClick={onLeave}>
        Leave
      </button>
    </header>
  );
}
