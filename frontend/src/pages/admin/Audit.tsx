import { useCallback, useEffect, useState } from "react";
import { api, type AuditEvent } from "../../api";
import { dateTime } from "../../components/ui";

const labels: Record<string, string> = {
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
};

const reasons: Record<string, string> = {
  bad_credentials: "неверный логин или пароль",
  inactive: "вход отключён",
  bad_totp: "неверный код",
  totp_not_enrolled: "телефон не привязан",
  access_denied: "нет доступа",
};

export function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [onlyFailures, setOnlyFailures] = useState(false);
  const [more, setMore] = useState(true);

  const load = useCallback(
    async (before?: number) => {
      const q = new URLSearchParams({ limit: "50" });
      if (before) q.set("before", String(before));
      if (onlyFailures) q.set("only_failures", "true");
      const page = await api.get<AuditEvent[]>(`/api/admin/audit?${q}`);
      setEvents((prev) => (before ? [...prev, ...page] : page));
      setMore(page.length === 50);
    },
    [onlyFailures],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">Журнал входов</h1>
          <p className="page-lead">Кто, когда и откуда входил, и что менялось в настройках.</p>
        </div>
      </header>

      <div className="toolbar">
        <label className="check">
          <input type="checkbox" checked={onlyFailures} onChange={(e) => setOnlyFailures(e.target.checked)} />
          <span>Только неудачные попытки</span>
        </label>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Когда</th><th>Событие</th><th>Кто</th><th>Где</th></tr>
          </thead>
          <tbody>
            {events.map((e) => {
              const reason = typeof e.details?.reason === "string" ? reasons[e.details.reason] : undefined;
              return (
                <tr key={e.id}>
                  <td className="num">{dateTime(e.ts)}</td>
                  <td>
                    <span className={e.success ? "primary" : "primary audit-fail"}>{labels[e.event] ?? e.event}</span>
                    {(e.target || reason) && (
                      <span className="secondary">{[e.target, reason].filter(Boolean).join(", ")}</span>
                    )}
                  </td>
                  <td>{e.actor ?? <span className="muted">неизвестно</span>}</td>
                  <td>
                    {e.project && <span className="primary">{e.project}</span>}
                    <span className="secondary">{e.ip ?? ""}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {events.length === 0 && <p className="muted" style={{ padding: "24px 0" }}>Событий пока нет.</p>}
      {more && events.length > 0 && (
        <div style={{ paddingTop: 20 }}>
          <button className="btn btn-quiet" type="button" onClick={() => load(events[events.length - 1].id)}>
            Показать ещё
          </button>
        </div>
      )}
    </>
  );
}
