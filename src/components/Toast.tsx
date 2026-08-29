import { useEffect, useRef } from 'react';

interface ToastProps {
  message: string;
  tone: 'info' | 'error';
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 6_000;

export function Toast({ message, tone, onDismiss }: ToastProps) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const timer = window.setTimeout(() => onDismissRef.current(), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [message, tone]);

  return (
    <div className={`toast toast-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <p>{message}</p>
      <button type="button" className="toast-dismiss" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
