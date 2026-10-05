import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError, errorText } from "../api";
import { useAuth } from "../auth";
import { CodeInput } from "../components/CodeInput";
import { Gate } from "../components/Gate";
import type { MarkState } from "../components/Mark";
import { CopyButton, Field, Notice } from "../components/ui";
import { useI18n } from "../i18n";

type Step = "credentials" | "totp" | "recovery" | "enroll" | "codes";
type Enrollment = { secret: string; otpauth_uri: string; qr_svg: string };

export function LoginPage() {
  const { t } = useI18n();
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
    const timer = window.setTimeout(() => setMark((m) => (m === "drawing" ? "idle" : m)), 1700);
    return () => window.clearTimeout(timer);
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
      setError(errorText(err, t));
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
    const text = `${t("codes.fileHeader", { user: username })}\n\n${codes.join("\n")}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "bastion-recovery-codes.txt" });
    a.click();
    URL.revokeObjectURL(url);
  };

  const switchTo = (s: Step) => {
    setError("");
    setStep(s);
  };

  return (
    <Gate mark={mark}>
      {params.get("signed_out") && step === "credentials" && !error && (
        <div style={{ marginBottom: 16 }}>
          <Notice kind="ok">{t("login.signedOut")}</Notice>
        </div>
      )}

      {step === "credentials" && (
        <>
          <h1 className="wall-title">{t("login.title")}</h1>
          <p className="wall-lead">{returnTo?.startsWith("/oidc/") ? t("login.leadOidc") : t("login.lead")}</p>
          <form className="wall-form" onSubmit={submitCredentials}>
            <Field
              label={t("login.username")}
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
              label={t("login.password")}
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Notice>{error}</Notice>
            <button className="btn btn-wide" type="submit" disabled={busy}>
              {busy ? t("login.checking") : t("login.continue")}
            </button>
          </form>
        </>
      )}

      {step === "totp" && (
        <>
          <h1 className="wall-title">{name ? t("totp.titleNamed", { name }) : t("totp.title")}</h1>
          <p className="wall-lead">{t("totp.lead")}</p>
          <div className="wall-form">
            <CodeInput onComplete={submitCode} disabled={busy} error={!!error} resetKey={resetKey} />
            <Notice>{error}</Notice>
            <p>
              <button className="link-button" type="button" onClick={() => switchTo("recovery")}>
                {t("totp.noPhone")}
              </button>
            </p>
          </div>
        </>
      )}

      {step === "recovery" && (
        <>
          <h1 className="wall-title">{t("recovery.title")}</h1>
          <p className="wall-lead">{t("recovery.lead")}</p>
          <form className="wall-form" onSubmit={submitRecovery}>
            <Field
              label={t("recovery.field")}
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
              {t("recovery.submit")}
            </button>
            <p>
              <button className="link-button" type="button" onClick={() => switchTo("totp")}>
                {t("recovery.useApp")}
              </button>
            </p>
          </form>
        </>
      )}

      {step === "enroll" && enrollment && (
        <>
          <h1 className="wall-title">{t("enroll.title")}</h1>
          <p className="wall-lead">{t("enroll.lead")}</p>
          <div className="wall-form">
            <div className="enroll">
              <div className="qr" dangerouslySetInnerHTML={{ __html: enrollment.qr_svg }} />
              <div className="enroll-key">
                <span>{t("enroll.manual")}</span>
                <span className="secret">{enrollment.secret.match(/.{1,4}/g)?.join(" ")}</span>
                <CopyButton value={enrollment.secret} label={t("enroll.copyKey")} />
              </div>
            </div>
            <div className="field">
              <span className="field-label">{t("enroll.code")}</span>
              <CodeInput onComplete={submitEnroll} disabled={busy} error={!!error} resetKey={resetKey} />
            </div>
            <Notice>{error}</Notice>
          </div>
        </>
      )}

      {step === "codes" && (
        <>
          <h1 className="wall-title">{t("codes.title")}</h1>
          <p className="wall-lead">{t("codes.lead")}</p>
          <div className="wall-form">
            <ul className="recovery-list">
              {codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="row-actions">
              <CopyButton value={codes.join("\n")} label={t("codes.copy")} />
              <button type="button" className="btn btn-quiet btn-small" onClick={downloadCodes}>
                {t("codes.download")}
              </button>
            </div>
            <button className="btn btn-wide" type="button" onClick={() => void go(next)}>
              {t("codes.done")}
            </button>
          </div>
        </>
      )}
    </Gate>
  );
}
