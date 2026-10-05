import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, errorText, type SessionInfo } from "../api";
import { useAuth } from "../auth";
import { CopyButton, Field, Notice, Pager, useFeedback, useFitRows, useFormat, usePaged, TABLE_RESERVE } from "../components/ui";
import { useI18n } from "../i18n";

export function AccountPage() {
  const { t } = useI18n();
  const fmt = useFormat();
  const { me, refresh } = useAuth();
  const { confirm, toast } = useFeedback();

  const [profile, setProfile] = useState({ display_name: me?.display_name ?? "", email: me?.email ?? "" });
  const [profileError, setProfileError] = useState("");

  const [pw, setPw] = useState({ current_password: "", new_password: "" });
  const [pwError, setPwError] = useState("");

  const [codesPassword, setCodesPassword] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [codesError, setCodesError] = useState("");

  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const loadSessions = useCallback(() => api.get<SessionInfo[]>("/api/me/sessions").then(setSessions), []);
  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const sessionsBox = useRef<HTMLDivElement>(null);
  const pageSize = useFitRows(sessionsBox, 58, TABLE_RESERVE, 1);
  const paged = usePaged(sessions, pageSize);

  if (!me) return null;

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setProfileError("");
    try {
      await api.patch("/api/me", { display_name: profile.display_name, email: profile.email || null });
      await refresh();
      toast(t("account.profileSaved"));
    } catch (err) {
      setProfileError(errorText(err, t));
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwError("");
    try {
      await api.post("/api/me/password", pw);
      setPw({ current_password: "", new_password: "" });
      await loadSessions();
      toast(t("account.changed"));
    } catch (err) {
      setPwError(errorText(err, t));
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
      setCodesError(errorText(err, t));
    }
  };

  const endSession = async (s: SessionInfo) => {
    const ok = await confirm({
      title: t("account.endTitle"),
      body: t("account.endBody", { device: fmt.device(s.user_agent) }),
      action: t("account.end"),
      danger: true,
    });
    if (!ok) return;
    await api.del(`/api/me/sessions/${s.id}`);
    await loadSessions();
    toast(t("account.ended"));
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">{t("account.title")}</h1>
          <p className="page-lead">{t("account.lead", { user: me.username, date: fmt.date(me.created_at) })}</p>
        </div>
      </header>

      <div className="account-grid">
        <section className="panel">
          <header className="panel-head">
            <h2 className="panel-title">{t("account.profile")}</h2>
            <p>{t("account.profileLead")}</p>
          </header>
          <form className="form-stack" onSubmit={saveProfile}>
            <div className="form-grid">
              <Field label={t("common.name")} required value={profile.display_name}
                onChange={(e) => setProfile({ ...profile, display_name: e.target.value })} />
              <Field label={t("common.email")} type="email" value={profile.email}
                onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
            </div>
            <Notice>{profileError}</Notice>
            <div><button className="btn" type="submit">{t("account.saveProfile")}</button></div>
          </form>
        </section>

        <section className="panel">
          <header className="panel-head">
            <h2 className="panel-title">{t("account.password")}</h2>
            <p>{t("account.passwordLead", { ago: fmt.ago(me.password_changed_at) })}</p>
          </header>
          <form className="form-stack" onSubmit={changePassword}>
            <div className="form-grid">
              <Field label={t("account.current")} type="password" autoComplete="current-password" required
                value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} />
              <Field label={t("account.new")} type="password" autoComplete="new-password" required minLength={10}
                placeholder={t("account.newHint")} value={pw.new_password}
                onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />
            </div>
            <Notice>{pwError}</Notice>
            <div><button className="btn" type="submit">{t("account.change")}</button></div>
          </form>
        </section>

        <section className="panel">
          <header className="panel-head">
            <h2 className="panel-title">{t("account.totp")}</h2>
            <p>{t("account.totpLead", { n: me.recovery_codes_left })}</p>
          </header>
          {me.recovery_codes_left <= 3 && !codes && <Notice kind="info">{t("account.codesLow")}</Notice>}
          {codes ? (
            <div className="form-stack">
              <Notice kind="ok">{t("account.codesReady")}</Notice>
              <ul className="recovery-list">
                {codes.map((c) => <li key={c}>{c}</li>)}
              </ul>
              <div className="row-actions">
                <CopyButton value={codes.join("\n")} />
                <button className="btn btn-quiet btn-small" type="button" onClick={() => setCodes(null)}>
                  {t("account.done")}
                </button>
              </div>
            </div>
          ) : (
            <form className="form-stack" onSubmit={newCodes}>
              <div className="form-grid">
                <Field label={t("account.confirmPassword")} type="password" autoComplete="current-password" required
                  value={codesPassword} onChange={(e) => setCodesPassword(e.target.value)} />
              </div>
              <Notice>{codesError}</Notice>
              <div><button className="btn btn-quiet" type="submit">{t("account.newCodes")}</button></div>
            </form>
          )}
        </section>

        <section className="panel">
          <header className="panel-head">
            <h2 className="panel-title">{t("account.sessions")}</h2>
            <p>{t("account.sessionsLead")}</p>
          </header>
          <div className="fill" ref={sessionsBox}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("account.device")}</th>
                    <th style={{ width: "30%" }}>{t("account.activity")}</th>
                    <th style={{ width: 120 }} aria-label="" />
                  </tr>
                </thead>
                <tbody>
                  {paged.slice.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <span className="primary">{fmt.device(s.user_agent)}</span>
                        <span className="secondary">{s.ip ?? t("common.unknownIp")}</span>
                      </td>
                      <td className="num">{s.current ? t("account.thisDevice") : fmt.ago(s.last_seen_at)}</td>
                      <td style={{ textAlign: "right" }}>
                        {!s.current && (
                          <button className="btn btn-quiet btn-small" type="button" onClick={() => endSession(s)}>
                            {t("account.end")}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={paged.page} pageSize={pageSize} total={paged.total} onPage={paged.setPage} />
          </div>
        </section>
      </div>
    </>
  );
}
