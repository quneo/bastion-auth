import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError, errorText } from "../api";
import { useAuth } from "../auth";
import { CodeInput } from "../components/CodeInput";
import { Gate } from "../components/Gate";
import type { MarkState } from "../components/Mark";
import { CopyButton, Field, Notice } from "../components/ui";

type Step = "credentials" | "totp" | "recovery" | "enroll" | "codes";
type Enrollment = { secret: string; otpauth_uri: string; qr_svg: string };

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { me, loading, setupRequired, refresh } = useAuth();
  const returnTo = params.get("return_to");

  const [step, setStep] = useState<Step>("credentials");
  const [mark, setMark] = useState<MarkState>("drawing");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [next, setNext] = useState("/");

  useEffect(() => {
    const t = window.setTimeout(() => setMark((m) => (m === "drawing" ? "idle" : m)), 1700);
    return () => window.clearTimeout(t);
  }, []);

  if (!loading && setupRequired) return <Navigate to="/setup" replace />;
  if (!loading && me && step === "credentials") {
    if (returnTo?.startsWith("/oidc/")) {
      window.location.assign(returnTo);
      return null;
    }
    return <Navigate to={returnTo || "/"} replace />;
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMark("busy");
    setError("");
    try {
      await fn();
    } catch (err) {
      setMark("idle");
      if (err instanceof ApiError && err.code === "challenge_expired") {
        setStep("credentials");
        setPassword("");
      }
      setError(errorText(err));
      setResetKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  };

  const go = async (target: string) => {
    setMark("done");
    await new Promise((r) => setTimeout(r, 520));
    if (target.startsWith("/oidc/")) {
      window.location.assign(target);
      return;
    }
    await refresh();
    navigate(target, { replace: true });
  };

  const submitCredentials = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const res = await api.post<{ step: "totp" | "enroll"; display_name: string }>("/api/auth/login", {
        username,
        password,
        return_to: returnTo,
      });
      setName(res.display_name);
      setPassword("");
      if (res.step === "enroll") {
        setEnrollment(await api.get<Enrollment>("/api/auth/enroll"));
      }
      setStep(res.step);
      setMark("idle");
    });
  };

  const submitCode = (code: string) =>
    run(async () => {
      const res = await api.post<{ return_to: string }>("/api/auth/totp", { code });
      await go(res.return_to);
    });

  const submitRecovery = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const res = await api.post<{ return_to: string }>("/api/auth/totp", { recovery_code: recoveryCode });
      await go(res.return_to);
    });
  };

  const submitEnroll = (code: string) =>
    run(async () => {
      const res = await api.post<{ return_to: string; recovery_codes: string[] }>("/api/auth/enroll", { code });
      setCodes(res.recovery_codes);
      setNext(res.return_to);
      setStep("codes");
      setMark("idle");
    });

  const downloadCodes = () => {
    const text = `Резервные коды Bastion для ${username}\nКаждый код работает один раз.\n\n${codes.join("\n")}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "bastion-recovery-codes.txt" });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Gate mark={mark}>
      {params.get("signed_out") && step === "credentials" && !error && (
        <div style={{ marginBottom: 20 }}>
          <Notice kind="ok">Вы вышли из Bastion.</Notice>
        </div>
      )}

      {step === "credentials" && (
        <>
          <h1 className="wall-title">Вход</h1>
          <p className="wall-lead">
            {returnTo?.startsWith("/oidc/")
              ? "Сервис просит подтвердить, кто вы. После входа вернём вас обратно."
              : "Логин и пароль, затем код из приложения на телефоне."}
          </p>
          <form className="wall-form" onSubmit={submitCredentials}>
            <Field
              label="Логин"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
            <Field
              label="Пароль"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Notice>{error}</Notice>
            <button className="btn btn-wide" type="submit" disabled={busy}>
              {busy ? "Проверяем…" : "Продолжить"}
            </button>
          </form>
        </>
      )}

      {step === "totp" && (
        <>
          <h1 className="wall-title">{name ? `${name}, ещё код` : "Код из приложения"}</h1>
          <p className="wall-lead">Откройте Google Authenticator и введите шесть цифр для Bastion.</p>
          <div className="wall-form">
            <CodeInput onComplete={submitCode} disabled={busy} error={!!error} resetKey={resetKey} />
            <Notice>{error}</Notice>
            <p>
              <button className="link-button" type="button" onClick={() => { setError(""); setStep("recovery"); }}>
                Нет телефона под рукой
              </button>
            </p>
          </div>
        </>
      )}

      {step === "recovery" && (
        <>
          <h1 className="wall-title">Резервный код</h1>
          <p className="wall-lead">Один из десяти кодов, которые вы сохранили при подключении. Каждый работает один раз.</p>
          <form className="wall-form" onSubmit={submitRecovery}>
            <Field
              label="Резервный код"
              placeholder="xxxxx-xxxxx"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
              autoFocus
            />
            <Notice>{error}</Notice>
            <button className="btn btn-wide" type="submit" disabled={busy}>
              Войти по резервному коду
            </button>
            <p>
              <button className="link-button" type="button" onClick={() => { setError(""); setStep("totp"); }}>
                Ввести код из приложения
              </button>
            </p>
          </form>
        </>
      )}

      {step === "enroll" && enrollment && (
        <>
          <h1 className="wall-title">Привяжите телефон</h1>
          <p className="wall-lead">
            Отсканируйте QR-код в Google Authenticator. Дальше при каждом входе понадобится код из приложения.
          </p>
          <div className="wall-form">
            <div className="qr" dangerouslySetInnerHTML={{ __html: enrollment.qr_svg }} />
            <details>
              <summary className="link-button" style={{ listStyle: "none", display: "inline" }}>
                Не сканируется? Ввести ключ вручную
              </summary>
              <div style={{ display: "grid", gap: 8, marginTop: 10, justifyItems: "start" }}>
                <span className="secret">{enrollment.secret.match(/.{1,4}/g)?.join(" ")}</span>
                <CopyButton value={enrollment.secret} label="Скопировать ключ" />
              </div>
            </details>
            <div className="field">
              <span className="field-label">Код из приложения</span>
              <CodeInput onComplete={submitEnroll} disabled={busy} error={!!error} resetKey={resetKey} />
            </div>
            <Notice>{error}</Notice>
          </div>
        </>
      )}

      {step === "codes" && (
        <>
          <h1 className="wall-title">Резервные коды</h1>
          <p className="wall-lead">
            Если телефон потеряется, войти можно будет одним из этих кодов. Сохраните их туда, где не потеряете.
          </p>
          <div className="wall-form">
            <ul className="recovery-list">
              {codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="row-actions">
              <CopyButton value={codes.join("\n")} label="Скопировать" />
              <button type="button" className="btn btn-quiet btn-small" onClick={downloadCodes}>
                Скачать .txt
              </button>
            </div>
            <button className="btn btn-wide" type="button" onClick={() => void go(next)}>
              Коды сохранены, продолжить
            </button>
          </div>
        </>
      )}
    </Gate>
  );
}
