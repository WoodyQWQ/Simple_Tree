import { useEffect, useRef, type ReactNode } from "react";
import { useDialogStore } from "../store/dialogStore";
import { useTreeStore } from "../store/treeStore";

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
  closeOnBackdrop = true,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  closeOnBackdrop?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !ref.current) return;
      const focusable = Array.from(
        ref.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !ref.current.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`modal${wide ? " modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <div className="modal-head">
          <span>{title}</span>
          <button className="icon-btn" aria-label="关闭" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialogHost() {
  const pending = useDialogStore((state) => state.pending);
  const resolve = useDialogStore((state) => state.resolve);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pending) {
      const id = window.setTimeout(() => cancelRef.current?.focus(), 20);
      return () => window.clearTimeout(id);
    }
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !dialogRef.current) return;
      const buttons = Array.from(
        dialogRef.current.querySelectorAll<HTMLButtonElement>("button:not([disabled])"),
      );
      if (buttons.length < 2) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pending]);

  if (!pending) return null;
  return (
    <div className="modal-backdrop">
      <div
        ref={dialogRef}
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-label={pending.title}
      >
        <div className="modal-head">
          <span>{pending.title}</span>
        </div>
        <div className="modal-body">
          <p style={{ margin: 0 }}>{pending.message}</p>
          {pending.extra && (
            <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 12 }}>
              {pending.extra}
            </p>
          )}
        </div>
        <div className="modal-foot">
          <button ref={cancelRef} className="btn" onClick={() => resolve(false)}>
            {pending.cancelLabel ?? "取消"}
          </button>
          <button
            className={`btn ${pending.danger ? "btn-danger" : "btn-primary"}`}
            onClick={() => resolve(true)}
          >
            {pending.confirmLabel ?? "确定"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ToastHost() {
  const toasts = useTreeStore((state) => state.toasts);
  const dismiss = useTreeStore((state) => state.dismissToast);
  return (
    <div className="toast-wrap">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast ${toast.type}${toast.leaving ? " leaving" : ""}`}
          role="status"
          aria-live="polite"
        >
          <span className="toast-dot" />
          <span style={{ flex: 1 }}>{toast.message}</span>
          {toast.actionLabel && toast.onAction && (
            <button
              className="toast-action"
              onClick={() => {
                toast.onAction?.();
                dismiss(toast.id);
              }}
            >
              {toast.actionLabel}
            </button>
          )}
          {toast.type === "error" && (
            <button className="toast-action" onClick={() => dismiss(toast.id)}>
              关闭
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

type IconName =
  | "plus"
  | "search"
  | "filter"
  | "outline"
  | "graph"
  | "sun"
  | "moon"
  | "settings"
  | "chevron"
  | "check"
  | "more"
  | "close"
  | "undo"
  | "download"
  | "upload"
  | "sparkle"
  | "fit"
  | "reset"
  | "minus"
  | "trash"
  | "calendar"
  | "tree"
  | "lock";

const PATHS: Record<IconName, ReactNode> = {
  plus: <path d="M9 3v12M3 9h12" />,
  search: (
    <>
      <circle cx="8" cy="8" r="5" />
      <path d="m12 12 4 4" />
    </>
  ),
  filter: <path d="M3 4h12l-4.6 5.4V15l-2.8 1.5V9.4Z" />,
  outline: (
    <>
      <path d="M5 4h11M8 9h8M11 14h5" />
    </>
  ),
  graph: (
    <>
      <circle cx="4" cy="9" r="1.6" />
      <circle cx="13" cy="4.5" r="1.6" />
      <circle cx="13" cy="13.5" r="1.6" />
      <path d="M5.5 8.5 11.5 5M5.5 9.5l6 3.4" />
    </>
  ),
  sun: (
    <>
      <circle cx="9" cy="9" r="3.2" />
      <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M14.3 3.7l-1.4 1.4M5.1 12.9l-1.4 1.4" />
    </>
  ),
  moon: <path d="M14.5 11.2A6.5 6.5 0 0 1 6.8 3.5 6.5 6.5 0 1 0 14.5 11.2Z" />,
  settings: (
    <>
      <path d="M3 5h12M3 9h12M3 13h12" />
      <circle cx="6.5" cy="5" r="1.5" />
      <circle cx="11.5" cy="9" r="1.5" />
      <circle cx="7.5" cy="13" r="1.5" />
    </>
  ),
  chevron: <path d="m7 5 4 4-4 4" />,
  check: <path d="m4.5 9.2 3 3 6-6.4" />,
  more: (
    <>
      <circle cx="4" cy="9" r="1" />
      <circle cx="9" cy="9" r="1" />
      <circle cx="14" cy="9" r="1" />
    </>
  ),
  close: <path d="m5 5 8 8M13 5l-8 8" />,
  undo: (
    <>
      <path d="M6.5 4.5 3 8l3.5 3.5" />
      <path d="M3 8h7a4.5 4.5 0 0 1 0 9H8" />
    </>
  ),
  download: (
    <>
      <path d="M9 2v9M5.5 8 9 11.5 12.5 8" />
      <path d="M3 13v2h12v-2" />
    </>
  ),
  upload: (
    <>
      <path d="M9 12V3M5.5 6.5 9 3l3.5 3.5" />
      <path d="M3 13v2h12v-2" />
    </>
  ),
  sparkle: (
    <>
      <path d="M9 2.5 10.4 7l4.6 1.5L10.4 10 9 14.5 7.6 10 3 8.5 7.6 7Z" />
    </>
  ),
  fit: (
    <>
      <path d="M3 7V3h4M15 7V3h-4M3 11v4h4M15 11v4h-4" />
    </>
  ),
  reset: (
    <>
      <path d="M4 9a5 5 0 1 0 1.5-3.5" />
      <path d="M4 3.5V7h3.5" />
    </>
  ),
  minus: <path d="M4 9h10" />,
  trash: (
    <>
      <path d="M3.5 5.5h11M7 5V3.5h4V5M5 5.5l.7 9h6.6l.7-9" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="12" height="11" rx="2" />
      <path d="M3 7.5h12M6.5 2.5v3M11.5 2.5v3" />
    </>
  ),
  tree: (
    <>
      <circle cx="9" cy="3.4" r="1.4" />
      <circle cx="4.5" cy="13" r="1.4" />
      <circle cx="13.5" cy="13" r="1.4" />
      <path d="M9 4.8v2.4M4.5 11.6v-1.2a1.6 1.6 0 0 1 1.6-1.6h5.8a1.6 1.6 0 0 1 1.6 1.6v1.2M9 7.2v0" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="8" width="10" height="7" rx="2" />
      <path d="M6.5 8V6a2.5 2.5 0 0 1 5 0v2" />
    </>
  ),
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-title">{title}</div>
      {description && <div style={{ fontSize: 12 }}>{description}</div>}
      {action}
    </div>
  );
}
