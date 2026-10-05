import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api, errorText } from "../api";
import { useAuth } from "../auth";
import { Gate } from "../components/Gate";
import { Field, Notice } from "../components/ui";

export function SetupPage() {
  const { loading, setupRequired, refresh } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ token: "", username: "", display_name: "", email: "", password: "" });
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
      await api.post("/api/auth/setup", { ...form, email: form.email || null });
      await refresh();
      navigate("/login", { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Gate mark="drawing">
      <h1 className="wall-title">Первый администратор</h1>
      <p className="wall-lead">
        Ключ настройки напечатан в логах контейнера: <code>docker logs bastion-auth</code>. После этого шага
        войдёте и привяжете телефон.
      </p>
      <form className="wall-form" onSubmit={submit}>
        <Field label="Ключ настройки" required autoComplete="off" spellCheck={false} value={form.token} onChange={set("token")} autoFocus />
        <Field label="Логин" required autoComplete="username" autoCapitalize="none" value={form.username} onChange={set("username")}
          hint="Латиница, цифры, точка, дефис" />
        <Field label="Как к вам обращаться" required value={form.display_name} onChange={set("display_name")} />
        <Field label="Email" type="email" value={form.email} onChange={set("email")} hint="Необязательно. Нужен, если сервисы сопоставляют людей по почте." />
        <Field label="Пароль" type="password" required minLength={10} autoComplete="new-password" value={form.password}
          onChange={set("password")} hint="Не короче 10 символов" />
        <Notice>{error}</Notice>
        <button className="btn btn-wide" type="submit" disabled={busy}>
          Создать администратора
        </button>
      </form>
    </Gate>
  );
}
