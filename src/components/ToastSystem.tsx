import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import React, { useEffect, useState } from 'react';

export type ToastType = 'success' | 'info' | 'warning' | 'error';

export interface ToastItem {
  id: string;
  message: string;
  type?: ToastType;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div
      id="toast-container"
      className="fixed bottom-16 sm:bottom-6 right-3 sm:right-6 z-[100] flex flex-col gap-2 max-w-[95vw] sm:max-w-md pointer-events-none"
      aria-live="polite"
      aria-atomic="true"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
      ))}
    </div>
  );
};

const ToastCard: React.FC<{ toast: ToastItem; onDismiss: () => void }> = ({ toast, onDismiss }) => {
  const { _ } = useLingui();
  const [isClosing, setIsClosing] = useState(false);
  const duration = toast.duration || (toast.action ? 6000 : 3500);
  const totalSeconds = Math.ceil(duration / 1000);
  const [secondsLeft, setSecondsLeft] = useState(totalSeconds);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsClosing(true);
      setTimeout(onDismiss, 200);
    }, duration);

    let interval: NodeJS.Timeout | undefined;
    if (duration >= 10000) {
      interval = setInterval(() => {
        setSecondsLeft((prev) => Math.max(0, prev - 1));
      }, 1000);
    }

    return () => {
      clearTimeout(timer);
      if (interval) clearInterval(interval);
    };
  }, [duration, onDismiss]);

  const handleManualDismiss = () => {
    setIsClosing(true);
    setTimeout(onDismiss, 200);
  };

  const typeConfig: Record<
    ToastType,
    { icon: string; dotClass: string; borderClass: string; bgClass: string; textClass: string }
  > = {
    success: {
      icon: 'check_circle',
      dotClass: 'bg-emerald-400',
      borderClass: 'border-emerald-800/60',
      bgClass: 'bg-[var(--surface-container-high)]/95',
      textClass: 'text-emerald-300',
    },
    error: {
      icon: 'error',
      dotClass: 'bg-rose-400',
      borderClass: 'border-rose-800/80',
      bgClass: 'bg-rose-950/95',
      textClass: 'text-rose-200',
    },
    warning: {
      icon: 'warning',
      dotClass: 'bg-amber-400',
      borderClass: 'border-amber-800/80',
      bgClass: 'bg-amber-950/95',
      textClass: 'text-amber-200',
    },
    info: {
      icon: 'info',
      dotClass: 'bg-sky-400',
      borderClass: 'border-sky-800/60',
      bgClass: 'bg-[var(--surface-container-high)]/95',
      textClass: 'text-sky-300',
    },
  };

  const config = typeConfig[toast.type || 'info'];

  const actionLabel = toast.action
    ? duration >= 10000 && /\(\d+s\)/.test(toast.action.label)
      ? toast.action.label.replace(/\(\d+s\)/, `(${secondsLeft}s)`)
      : toast.action.label
    : '';

  return (
    <div
      id={`toast-card-${toast.id}`}
      role={toast.type === 'error' ? 'alert' : 'status'}
      className={`pointer-events-auto relative overflow-hidden flex items-center justify-between gap-3 px-3 py-2 rounded-md border ${config.borderClass} ${config.bgClass} shadow-md text-xs font-sans text-[var(--on-surface)] transition-all duration-150 ${
        isClosing ? 'opacity-0 translate-y-1' : 'opacity-100 translate-y-0'
      }`}
    >
      <div id="div-toastsystem-1" className="flex items-center gap-2 min-w-0">
        <span className={`material-symbols-outlined text-[16px] ${config.textClass} shrink-0`}>
          {config.icon}
        </span>
        <span className="truncate max-w-[240px] sm:max-w-xs font-medium leading-tight">
          {toast.message}
        </span>
      </div>

      <div id="div-toastsystem-2" className="flex items-center gap-1.5 shrink-0">
        {toast.action && (
          <button
            id={`btn-toast-action-${toast.id}`}
            type="button"
            onClick={() => {
              toast.action?.onClick();
              handleManualDismiss();
            }}
            className="px-2 py-0.5 rounded bg-[var(--primary)] text-[var(--on-primary)] font-medium text-[11px] hover:brightness-110 active:opacity-90 transition-opacity cursor-pointer flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[13px]">undo</span>
            <span>{actionLabel}</span>
          </button>
        )}

        <button
          id={`btn-toast-dismiss-${toast.id}`}
          type="button"
          onClick={handleManualDismiss}
          className="p-0.5 rounded text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-container-highest)] cursor-pointer transition-colors"
          aria-label={_(msg`Cerrar notificación`)}
        >
          <span className="material-symbols-outlined text-[15px]">close</span>
        </button>
      </div>

      {duration >= 10000 && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-black/30 overflow-hidden">
          <div
            className="h-full bg-amber-400 transition-all ease-linear"
            style={{
              width: `${(secondsLeft / totalSeconds) * 100}%`,
              transitionDuration: '1000ms',
            }}
          />
        </div>
      )}
    </div>
  );
};
