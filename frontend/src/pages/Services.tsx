import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Service } from "../api";
import { useAuth } from "../auth";
import { Notice } from "../components/ui";

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export function ServicesPage() {
  const { me } = useAuth();
  const [services, setServices] = useState<Service[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.get<Service[]>("/api/me/services").then(setServices, () => setFailed(true));
  }, []);

  const firstName = me?.display_name.split(" ")[0];

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">Куда идём, {firstName}?</h1>
          <p className="page-lead">Сервисы, в которые вам открыт вход через Bastion.</p>
        </div>
      </header>

      {failed && <Notice>Не удалось загрузить список. Обновите страницу.</Notice>}

      {services && services.length === 0 && (
        <div className="empty">
          <p>Пока ни одного сервиса. Их добавляет администратор в разделе «Проекты».</p>
          {me?.is_admin && (
            <Link className="btn" to="/admin/projects">
              Зарегистрировать проект
            </Link>
          )}
        </div>
      )}

      {services && services.length > 0 && (
        <div className="services">
          {services.map((s) =>
            s.url ? (
              <a key={s.id} className="service" href={s.url}>
                <div>
                  <div className="service-name">{s.name}</div>
                  {s.description && <p className="service-desc">{s.description}</p>}
                </div>
                <span className="service-host">{host(s.url)}</span>
              </a>
            ) : (
              <div key={s.id} className="service">
                <div>
                  <div className="service-name">{s.name}</div>
                  {s.description && <p className="service-desc">{s.description}</p>}
                </div>
                <span className="service-host">без ссылки</span>
              </div>
            ),
          )}
        </div>
      )}
    </>
  );
}
