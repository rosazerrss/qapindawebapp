'use client';

/**
 * Toasts.
 *
 * For the small confirmations that would be rude as a dialog: "saved",
 * "suspended", "coupon created". They appear bottom-right on a desktop, top on
 * a phone, and disappear on their own.
 *
 * A toast never carries information the user must act on. Anything that needs a
 * decision is a dialog; anything that must be read later is on the page.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';

import { cn } from '@/components/ui';

type Tone = 'success' | 'danger' | 'info';

interface Toast {
  id: number;
  tone: Tone;
  text: string;
}

const ToastContext = createContext<{
  show: (text: string, tone?: Tone) => void;
} | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  // Screens outside the panel have no toaster; a no-op keeps them from crashing.
  return context ?? { show: () => {} };
}

const ICONS = { success: CheckCircle2, danger: TriangleAlert, info: Info } as const;

const TONES = {
  success: 'border-green-200 bg-white text-success',
  danger: 'border-red-200 bg-white text-danger',
  info: 'border-ink-200 bg-white text-ink-700',
} as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const sequence = useRef(0);

  const show = useCallback((text: string, tone: Tone = 'success') => {
    const id = (sequence.current += 1);
    setToasts((current) => [...current, { id, tone, text }]);
    setTimeout(() => setToasts((current) => current.filter((entry) => entry.id !== id)), 4000);
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div
        className="pointer-events-none fixed inset-x-4 top-4 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:top-auto sm:items-end"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => {
          const Icon = ICONS[toast.tone];

          return (
            <div
              key={toast.id}
              className={cn(
                // `shadow-popover` rather than `shadow-lg`: a toast lands on a
                // white panel with nothing dimmed behind it, and the tone
                // border alone was not enough to tell it from the page.
                'pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm shadow-popover',
                TONES[toast.tone],
              )}
            >
              <Icon size={17} className="mt-0.5 shrink-0" />
              <span className="flex-1 text-ink-800">{toast.text}</span>
              <button
                onClick={() => setToasts((current) => current.filter((e) => e.id !== toast.id))}
                className="shrink-0 rounded p-0.5 text-ink-400 hover:text-ink-800"
                aria-label="×"
              >
                <X size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
