import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, errorText, type SessionInfo } from "../api";
import { useAuth } from "../auth";
import { ago, browserName, CopyButton, date, Field, Notice, useFeedback } from "../components/ui";

export function AccountPage() {
  const { me, refresh } = useAuth();
  const { confirm, toast } = useFeedback();

  const [profile, setProfile] = useState({ display_name: me?.display_name ?? "", email: me?.email ?? "" });
  const [profileError, setProfileError] = useState("");

  const [pw, setPw] = useState({ current_password: "", new_password: "" });
  const [pwError, setPwError] = useState("");

  const [codesPassword, setCodesPassword] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [codesError, setCodesError] = useState("");

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const loadSessions = useCallback(() => api.get<SessionInfo[]>("/api/me/sessions").then(setSessions), []);
  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  if (!me) return null;

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setProfileError("");
    try {
      await api.patch("/api/me", { display_name: profile.display_name, email: profile.email || null });
      await refresh();
      toast("Профиль сохранён");
    } catch (err) {
      setProfileError(errorText(err));
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwError("");
    try {
      await api.post("/api/me/password", pw);
      setPw({ current_password: "", new_password: "" });
      await loadSessions();
      toast("Пароль изменён, остальные устройства вышли");
    } catch (err) {
      setPwError(errorText(err));
    }
  };

  const newCodes = async (e: FormEvent) => {
    e.preventDefault();
    setCodesError("");
    try {
      const res = await api.post<{ recovery_codes: string[] }>("/api/me/recovery-codes", { password: codesPassword });
      setCodes(res.recovery_codes);
      setCodesPassword("");
      await refresh();
    } catch (err) {
      setCodesError(errorText(err));
    }
  };

  const endSession = async (s: SessionInfo) => {
    const ok = await confirm({
      title: "Завершить сеанс?",
      body: `${browserName(s.user_agent)} выйдет из Bastion.`,
      action: "Завершить",
      danger: true,
    });
    if (!ok) return;
    await api.del(`/api/me/sessions/${s.id}`);
    await loadSessions();
    toast("Сеанс завершён");
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">Профиль и вход</h1>
          <p className="page-lead">
            Логин {me.username}. В Bastion с {date(me.created_at)}.
          </p>
        </div>
      </header>

      <section className="section-grid">
        <header>
          <h2 className="section-title">Профиль</h2>
          <p>Имя и почту видят сервисы, в которые вы входите.</p>
        </header>
        <form className="form-stack" onSubmit={saveProfile}>
          <Field label="Имя" required value={profile.display_name}
            onChange={(e) => setProfile({ ...profile, display_name: e.target.value })} />
          <Field label="Email" type="email" value={profile.email}
            onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
          <Notice>{profileError}</Notice>
          <div><button className="btn" type="submit">Сохранить профиль</button></div>
        </form>
      </section>

      <section className="section-grid">
        <header>
          <h2 className="section-title">Пароль</h2>
          <p>Последняя смена {ago(me.password_changed_at)}. После смены остальные устройства выйдут.</p>
        </header>
        <form className="form-stack" onSubmit={changePassword}>
          <Field label="Текущий пароль" type="password" autoComplete="current-password" required
            value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} />
          <Field label="Новый пароль" type="password" autoComplete="new-password" required minLength={10}
            hint="Не короче 10 символов" value={pw.new_password}
            onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />
          <Notice>{pwError}</Notice>
          <div><button className="btn" type="submit">Сменить пароль</button></div>
        </form>
      </section>

      <section className="section-grid">
        <header>
          <h2 className="section-title">Код из приложения</h2>
          <p>Google Authenticator подключён. Резервных кодов осталось: {me.recovery_codes_left} из 10.</p>
        </header>
        <div className="form-stack">
          {me.recovery_codes_left <= 3 && !codes && (
            <Notice kind="info">Кодов почти не осталось. Выпустите новый набор, старые перестанут работать.</Notice>
          )}
          {codes ? (
            <>
              <Notice kind="ok">Новые коды готовы. Старые больше не работают.</Notice>
              <ul className="recovery-list">
                {codes.map((c) => <li key={c}>{c}</li>)}
              </ul>
              <div className="row-actions">
                <CopyButton value={codes.join("\n")} />
                <button className="btn btn-quiet btn-small" type="button" onClick={() => setCodes(null)}>Готово</button>
              </div>
            </>
          ) : (
            <form className="form-stack" onSubmit={newCodes}>
              <Field label="Пароль для подтверждения" type="password" autoComplete="current-password" required
                value={codesPassword} onChange={(e) => setCodesPassword(e.target.value)} />
              <Notice>{codesError}</Notice>
              <div><button className="btn btn-quiet" type="submit">Выпустить новые резервные коды</button></div>
            </form>
          )}
        </div>
      </section>

      <section className="section-grid">
        <header>
          <h2 className="section-title">Где вы вошли</h2>
          <p>Если устройство незнакомо, завершите сеанс и смените пароль.</p>
        </header>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Устройство</th><th>Активность</th><th aria-label="Действия" /></tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>
                    <span className="primary">{browserName(s.user_agent)}</span>
                    <span className="secondary">{s.ip ?? "адрес неизвестен"}</span>
                  </td>
                  <td className="num">{s.current ? "это устройство" : ago(s.last_seen_at)}</td>
                  <td style={{ textAlign: "right" }}>
                    {!s.current && (
                      <button className="btn btn-quiet btn-small" type="button" onClick={() => endSession(s)}>
                        Завершить
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
