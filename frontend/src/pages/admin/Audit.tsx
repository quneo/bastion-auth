import { useEffect, useRef, useState } from "react";
import { api, type AuditEvent } from "../../api";
import { Pager, useFitRows, useFormat, TABLE_RESERVE } from "../../components/ui";
import { useI18n, type Lang } from "../../i18n";

const labels: Record<Lang, Record<string, string>> = {
  en: {
    login: "Signed in",
    login_failed: "Failed sign-in",
    logout: "Signed out",
    totp_failed: "Wrong code",
    totp_enroll_failed: "Wrong code while binding",
    totp_enrolled: "Phone bound",
    totp_reset: "Phone unbound",
    recovery_code_used: "Signed in with recovery code",
    recovery_code_failed: "Wrong recovery code",
    recovery_codes_regenerated: "New recovery codes",
    password_changed: "Password changed",
    password_set: "Password set by admin",
    password_check_failed: "Wrong password on confirmation",
    profile_updated: "Profile updated",
    session_ended: "Session ended",
    sessions_revoked: "All sessions ended",
    setup_completed: "Bastion set up",
    setup_failed: "Wrong setup key",
    user_created: "Person added",
    user_updated: "Person changed",
    user_deleted: "Person deleted",
    group_created: "Group created",
    group_updated: "Group changed",
    group_deleted: "Group deleted",
    project_created: "Project registered",
    project_updated: "Project changed",
    project_deleted: "Project deleted",
    project_secret_rotated: "New project secret",
    oidc_authorize: "Signed in to a project",
    oidc_token: "Project received a token",
    oidc_denied: "No access to a project",
    api_login: "Signed in via project form",
    api_login_failed: "Failed sign-in via project",
  },
  ru: {
    login: "Вход",
    login_failed: "Неудачный вход",
    logout: "Выход",
    totp_failed: "Неверный код",
    totp_enroll_failed: "Неверный код при привязке",
    totp_enrolled: "Привязан телефон",
    totp_reset: "Телефон отвязан",
    recovery_code_used: "Вход по резервному коду",
    recovery_code_failed: "Неверный резервный код",
    recovery_codes_regenerated: "Новые резервные коды",
    password_changed: "Сменён пароль",
    password_set: "Пароль задан администратором",
    password_check_failed: "Неверный пароль при подтверждении",
    profile_updated: "Обновлён профиль",
    session_ended: "Завершён сеанс",
    sessions_revoked: "Завершены все сеансы",
    setup_completed: "Bastion настроен",
    setup_failed: "Неверный ключ настройки",
    user_created: "Добавлен человек",
    user_updated: "Изменён человек",
    user_deleted: "Удалён человек",
    group_created: "Создана группа",
    group_updated: "Изменена группа",
    group_deleted: "Удалена группа",
    project_created: "Зарегистрирован проект",
    project_updated: "Изменён проект",
    project_deleted: "Удалён проект",
    project_secret_rotated: "Новый секрет проекта",
    oidc_authorize: "Вход в проект",
    oidc_token: "Проект получил токен",
    oidc_denied: "Нет доступа к проекту",
    api_login: "Вход через форму проекта",
    api_login_failed: "Неудачный вход через проект",
  },
};

const reasons: Record<Lang, Record<string, string>> = {
  en: {
    bad_credentials: "wrong username or password",
    inactive: "sign-in disabled",
    bad_totp: "wrong code",
    totp_not_enrolled: "phone not bound",
    access_denied: "no access",
  },
  ru: {
    bad_credentials: "неверный логин или пароль",
    inactive: "вход отключён",
    bad_totp: "неверный код",
    totp_not_enrolled: "телефон не привязан",
    access_denied: "нет доступа",
  },
};

export function AuditPage() {
  const { t, lang } = useI18n();
  const fmt = useFormat();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [onlyFailures, setOnlyFailures] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const fill = useRef<HTMLDivElement>(null);
  const pageSize = useFitRows(fill, 58, TABLE_RESERVE);

  useEffect(() => {
    const q = new URLSearchParams({ limit: String(pageSize + 1), offset: String(page * pageSize) });
    if (onlyFailures) q.set("only_failures", "true");
    api.get<AuditEvent[]>(`/api/admin/audit?${q}`).then((rows) => {
      setEvents(rows.slice(0, pageSize));
      setHasMore(rows.length > pageSize);
      setLoaded(true);
    });
  }, [page, pageSize, onlyFailures]);

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">{t("audit.title")}</h1>
          <p className="page-lead">{t("audit.lead")}</p>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={onlyFailures}
            onChange={(e) => {
              setOnlyFailures(e.target.checked);
              setPage(0);
            }}
          />
          <span>{t("audit.onlyFailures")}</span>
        </label>
      </header>

      <div className="fill" ref={fill}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: "17%" }}>{t("audit.when")}</th>
                <th>{t("audit.event")}</th>
                <th style={{ width: "18%" }}>{t("audit.who")}</th>
                <th style={{ width: "22%" }}>{t("audit.where")}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const reason = typeof e.details?.reason === "string" ? reasons[lang][e.details.reason] : undefined;
                const sub = [e.target, reason].filter(Boolean).join(", ");
                return (
                  <tr key={e.id}>
                    <td className="num">{fmt.dateTime(e.ts)}</td>
                    <td>
                      <span className={e.success ? "primary" : "primary audit-fail"}>{labels[lang][e.event] ?? e.event}</span>
                      {sub && <span className="secondary">{sub}</span>}
                    </td>
                    <td>{e.actor ?? <span className="muted">{t("audit.unknown")}</span>}</td>
                    <td>
                      {e.project && <span className="primary">{e.project}</span>}
                      <span className="secondary">{e.ip ?? ""}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {loaded && events.length === 0 && <p className="muted" style={{ padding: "20px 0" }}>{t("audit.empty")}</p>}
        </div>
        <Pager page={page} pageSize={pageSize} hasMore={hasMore} onPage={setPage} />
      </div>
    </>
  );
}
