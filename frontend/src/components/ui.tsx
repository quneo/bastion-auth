import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type RefObject,
  type TextareaHTMLAttributes,
} from "react";
import { useI18n, type T } from "../i18n";

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
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input, textarea, [role=tab], button")?.focus();
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
          <button className="close" type="button" onClick={onClose} aria-label={t("common.close")}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Tabs<K extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={tab.key === value}
          className="tab"
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
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
  const { t } = useI18n();
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
                {t("common.cancel")}
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

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const { toast } = useFeedback();
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="btn btn-quiet btn-small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          toast(t("common.copied"));
        } catch {
          toast(t("common.copyFailed"));
        }
      }}
    >
      {label ?? t("common.copy")}
    </button>
  );
}

/** Formatting helpers bound to the current language. */
export function useFormat() {
  const { t, locale } = useI18n();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const dtf = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });
  const tf = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return {
    ago(iso: string | null | undefined): string {
      if (!iso) return t("common.never");
      const diff = (new Date(iso).getTime() - Date.now()) / 1000;
      const abs = Math.abs(diff);
      if (abs < 60) return t("common.justNow");
      if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
      if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
      if (abs < 86400 * 14) return rtf.format(Math.round(diff / 86400), "day");
      return dtf.format(new Date(iso));
    },
    date: (iso: string) => dtf.format(new Date(iso)),
    dateTime: (iso: string) => tf.format(new Date(iso)),
    device: (ua: string | null) => browserName(ua, t),
  };
}

function browserName(ua: string | null, t: T): string {
  if (!ua) return t("common.unknownDevice");
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
      ? "Yandex Browser"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : t("common.browser");
  return os ? `${browser}, ${os}` : browser;
}

/** Space a paged table needs besides its rows: header row, borders and the pager. */
export const TABLE_RESERVE = 96;

/**
 * How many fixed-height rows fit into the element without scrolling.
 * `reserve` is the space taken inside the element by the table head and the pager.
 */
export function useFitRows(ref: RefObject<HTMLElement | null>, rowHeight: number, reserve: number, min = 3): number {
  const [rows, setRows] = useState(8);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setRows(Math.max(min, Math.floor((el.clientHeight - reserve) / rowHeight)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, rowHeight, reserve, min]);
  return rows;
}

export function Pager({
  page,
  pageSize,
  total,
  hasMore,
  onPage,
}: {
  page: number;
  pageSize: number;
  total?: number;
  hasMore?: boolean;
  onPage: (page: number) => void;
}) {
  const { t } = useI18n();
  const from = page * pageSize + 1;
  const to = total !== undefined ? Math.min(total, (page + 1) * pageSize) : (page + 1) * pageSize;
  const more = total !== undefined ? to < total : !!hasMore;
  if (page === 0 && !more) return null;
  return (
    <div className="pager">
      <span className="muted">
        {total !== undefined ? t("common.page", { from, to, total }) : t("common.pageNoTotal", { from, to })}
      </span>
      <div className="row-actions">
        <button className="btn btn-quiet btn-small" type="button" disabled={page === 0} onClick={() => onPage(page - 1)}>
          {t("common.prev")}
        </button>
        <button className="btn btn-quiet btn-small" type="button" disabled={!more} onClick={() => onPage(page + 1)}>
          {t("common.next")}
        </button>
      </div>
    </div>
  );
}

/** Client-side paging of a list into pages that fit the container height. */
export function usePaged<T>(items: T[] | null, pageSize: number) {
  const [page, setPage] = useState(0);
  const total = items?.length ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pages - 1);
  return {
    page: current,
    setPage,
    total,
    slice: (items ?? []).slice(current * pageSize, (current + 1) * pageSize),
  };
}
