import { useEffect, useRef, useState } from 'react';

interface JoinCodeBarProps {
  code: string;
  onLeave: () => void;
  canZoomOut: boolean;
  canZoomIn: boolean;
  onZoomOut: () => void;
  onZoomIn: () => void;
}

function ZoomGlyph({ kind }: { kind: 'out' | 'in' }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path
        d={kind === 'out' ? 'M7 16 H25' : 'M7 16 H25 M16 7 V25'}
        fill="none"
        stroke="#111"
        strokeWidth="6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function JoinCodeBar({
  code,
  onLeave,
  canZoomOut,
  canZoomIn,
  onZoomOut,
  onZoomIn,
}: JoinCodeBarProps) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard may be unavailable on some mobile browsers.
    }
  };

  return (
    <header className="join-code-wrap">
      <div className="join-code-bar">
        <div className="join-code-copy">
          <span className="join-code-label">Nest code</span>
          <button type="button" className="join-code-value" onClick={copyCode}>
            {copied ? 'Copied' : code}
          </button>
        </div>
        <div className="join-code-tools">
          <div className="zoom-controls">
            <button
              type="button"
              className="btn btn-ghost zoom-btn"
              aria-label="Zoom out"
              disabled={!canZoomOut}
              onClick={onZoomOut}
            >
              <ZoomGlyph kind="out" />
            </button>
            <button
              type="button"
              className="btn btn-ghost zoom-btn"
              aria-label="Zoom in"
              disabled={!canZoomIn}
              onClick={onZoomIn}
            >
              <ZoomGlyph kind="in" />
            </button>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onLeave}>
            Fly the nest
          </button>
        </div>
      </div>
    </header>
  );
}
