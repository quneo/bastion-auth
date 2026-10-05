import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api, errorText } from "../api";
import { useAuth } from "../auth";
import { Gate } from "../components/Gate";
import { Field, Notice } from "../components/ui";
import { useI18n } from "../i18n";

export function SetupPage() {
  const { t } = useI18n();
  const { loading, setupRequired, refresh } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ token: "", username: "", display_name: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!loading && !setupRequired) return <Navigate to="/login" replace />;

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post("/api/auth/setup", form);
      await refresh();
      navigate("/login", { replace: true });
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  };

  const [before, after] = t("setup.lead").split("{cmd}");

  return (
    <Gate mark="drawing">
      <h1 className="wall-title">{t("setup.title")}</h1>
      <p className="wall-lead">
        {before}
        <code>docker logs bastion-auth</code>
        {after}
      </p>
      <form className="wall-form" onSubmit={submit}>
        <Field label={t("setup.token")} required autoComplete="off" spellCheck={false} value={form.token}
          onChange={set("token")} autoFocus />
        <Field label={t("setup.username")} required autoComplete="username" autoCapitalize="none"
          placeholder={t("setup.usernameHint")} value={form.username} onChange={set("username")} />
        <Field label={t("setup.name")} required value={form.display_name} onChange={set("display_name")} />
        <Field label={t("setup.password")} type="password" required minLength={10} autoComplete="new-password"
          placeholder={t("setup.passwordHint")} value={form.password} onChange={set("password")} />
        <Notice>{error}</Notice>
        <button className="btn btn-wide" type="submit" disabled={busy}>
          {t("setup.submit")}
        </button>
      </form>
    </Gate>
  );
}
