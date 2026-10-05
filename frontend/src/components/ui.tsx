import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

export function Field({
  label,
  hint,
  ...props
}: { label: string; hint?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input id={id} className="input" {...props} />
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function TextArea({
  label,
  hint,
  ...props
}: { label: string; hint?: ReactNode } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <textarea id={id} className="input" {...props} />
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function Notice({ kind = "error", children }: { kind?: "error" | "ok" | "info"; children: ReactNode }) {
  if (!children) return null;
  const cls = kind === "ok" ? "notice notice-ok" : kind === "info" ? "notice notice-info" : "notice";
  return (
    <div className={cls} role={kind === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function Drawer({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input, textarea, button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="drawer-head">
          <div>
            <h2 className="drawer-title">{title}</h2>
            {subtitle && <p className="drawer-sub">{subtitle}</p>}
          </div>
          <button className="close" type="button" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

type ConfirmOptions = { title: string; body: ReactNode; action: string; danger?: boolean };
type ToastFn = (text: string) => void;

const FeedbackContext = createContext<{
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  toast: ToastFn;
}>({ confirm: async () => false, toast: () => undefined });

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [toastText, setToastText] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...opts, resolve })),
    [],
  );
  const toast = useCallback((text: string) => {
    setToastText(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToastText(null), 2600);
  }, []);

  const close = (value: boolean) => {
    pending?.resolve(value);
    setPending(null);
  };

  return (
    <FeedbackContext.Provider value={{ confirm, toast }}>
      {children}
      {pending && (
        <div className="dialog-scrim" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-label={pending.title}>
            <h2>{pending.title}</h2>
            <div>{pending.body}</div>
            <div className="row-actions">
              <button
                className={pending.danger ? "btn btn-danger" : "btn"}
                type="button"
                autoFocus
                onClick={() => close(true)}
              >
                {pending.action}
              </button>
              <button className="btn btn-quiet" type="button" onClick={() => close(false)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
      {toastText && (
        <div className="toast" role="status">
          {toastText}
        </div>
      )}
    </FeedbackContext.Provider>
  );
}

export const useFeedback = () => useContext(FeedbackContext);

export function CopyButton({ value, label = "Скопировать" }: { value: string; label?: string }) {
  const { toast } = useFeedback();
  return (
    <button
      type="button"
      className="btn btn-quiet btn-small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          toast("Скопировано");
        } catch {
          toast("Не получилось скопировать — выделите текст вручную");
        }
      }}
    >
      {label}
    </button>
  );
}

const rtf = new Intl.RelativeTimeFormat("ru", { numeric: "auto" });
const dtf = new Intl.DateTimeFormat("ru", { day: "numeric", month: "short", year: "numeric" });
const tf = new Intl.DateTimeFormat("ru", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function ago(iso: string | null | undefined): string {
  if (!iso) return "никогда";
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return "только что";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 14) return rtf.format(Math.round(diff / 86400), "day");
  return dtf.format(new Date(iso));
}

export const dateTime = (iso: string) => tf.format(new Date(iso));
export const date = (iso: string) => dtf.format(new Date(iso));

export function browserName(ua: string | null): string {
  if (!ua) return "Неизвестное устройство";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : /Mac OS/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /YaBrowser/.test(ua)
      ? "Яндекс Браузер"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Браузер";
  return os ? `${browser}, ${os}` : browser;
}
