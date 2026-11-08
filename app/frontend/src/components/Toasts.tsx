import { useEffect } from 'react';
import { useUi } from '../state/ui';

/** Plain-language messages with a "Copy details" button for errors (PRD 7). */
export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismiss);
  useEffect(() => {
    const timers = toasts.filter((t) => t.kind === 'info').map((t) => window.setTimeout(() => dismiss(t.id), 4000));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [toasts, dismiss]);
  return (
    <div className="toasts" role="status">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span>{t.message}</span>
          {t.details && <button onClick={() => navigator.clipboard.writeText(t.details!)}>Copy details</button>}
          <button aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
