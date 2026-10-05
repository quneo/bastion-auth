import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { useI18n } from "../i18n";

/** Six cells for a TOTP code. Calls onComplete as soon as all six digits are in. */
export function CodeInput({
  onComplete,
  disabled,
  error,
  resetKey,
}: {
  onComplete: (code: string) => void;
  disabled?: boolean;
  error?: boolean;
  resetKey?: number;
}) {
  const { t } = useI18n();
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    setDigits(Array(6).fill(""));
    refs.current[0]?.focus();
  }, [resetKey]);

  const update = (next: string[]) => {
    setDigits(next);
    if (next.every((d) => d !== "")) onComplete(next.join(""));
  };

  const put = (index: number, value: string) => {
    const clean = value.replace(/\D/g, "");
    if (!clean) return;
    const next = [...digits];
    let i = index;
    for (const ch of clean) {
      if (i > 5) break;
      next[i++] = ch;
    }
    refs.current[Math.min(i, 5)]?.focus();
    update(next);
  };

  const onKey = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const next = [...digits];
      if (next[index]) {
        next[index] = "";
      } else if (index > 0) {
        next[index - 1] = "";
        refs.current[index - 1]?.focus();
      }
      setDigits(next);
    } else if (e.key === "ArrowLeft" && index > 0) {
      refs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < 5) {
      refs.current[index + 1]?.focus();
    }
  };

  const onPaste = (index: number, e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    put(index, e.clipboardData.getData("text"));
  };

  const cell = (i: number) => (
    <input
      key={i}
      ref={(el) => {
        refs.current[i] = el;
      }}
      className="code-cell"
      inputMode="numeric"
      autoComplete={i === 0 ? "one-time-code" : "off"}
      maxLength={6}
      aria-label={t("totp.digit", { n: i + 1 })}
      value={digits[i]}
      disabled={disabled}
      onChange={(e) => put(i, e.target.value.slice(-6))}
      onKeyDown={(e) => onKey(i, e)}
      onPaste={(e) => onPaste(i, e)}
      onFocus={(e) => e.target.select()}
    />
  );

  return (
    <div className="code-cells" data-error={error ? "true" : "false"} role="group" aria-label={t("totp.group")}>
      {cell(0)}
      {cell(1)}
      {cell(2)}
      <span className="code-gap" aria-hidden="true" />
      {cell(3)}
      {cell(4)}
      {cell(5)}
    </div>
  );
}
