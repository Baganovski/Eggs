interface ToastProps {
  message: string;
  tone: 'info' | 'error';
  onDismiss: () => void;
}

export function Toast({ message, tone, onDismiss }: ToastProps) {
  return (
    <div className={`toast toast-${tone}`} role="status">
      <p>{message}</p>
      <button type="button" className="toast-dismiss" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
