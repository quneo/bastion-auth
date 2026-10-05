import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Service } from "../api";
import { useAuth } from "../auth";
import { Notice, Pager, useFitRows, usePaged } from "../components/ui";
import { useI18n } from "../i18n";

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export function ServicesPage() {
  const { t } = useI18n();
  const { me } = useAuth();
  const [services, setServices] = useState<Service[] | null>(null);
  const [failed, setFailed] = useState(false);
  const fill = useRef<HTMLDivElement>(null);
  const pageSize = useFitRows(fill, 84, 1 + 46);
  const paged = usePaged(services, pageSize);

  useEffect(() => {
    api.get<Service[]>("/api/me/services").then(setServices, () => setFailed(true));
  }, []);

  const name = me?.display_name ?? "";

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">{t("services.title", { name })}</h1>
          <p className="page-lead">{t("services.lead")}</p>
        </div>
      </header>

      {failed && <Notice>{t("common.loadFailed")}</Notice>}

      {services && services.length === 0 && (
        <div className="empty">
          <p>{t("services.empty")}</p>
          {me?.is_admin && (
            <Link className="btn" to="/admin/projects">
              {t("services.register")}
            </Link>
          )}
        </div>
      )}

      <div className="fill" ref={fill}>
        {services && services.length > 0 && (
          <>
            <div className="services">
              {paged.slice.map((s) => {
                const body = (
                  <>
                    <div style={{ minWidth: 0 }}>
                      <div className="service-name">{s.name}</div>
                      {s.description && <p className="service-desc">{s.description}</p>}
                    </div>
                    <span className="service-host">{s.url ? host(s.url) : t("services.noLink")}</span>
                  </>
                );
                return s.url ? (
                  <a key={s.id} className="service" href={s.url}>
                    {body}
                  </a>
                ) : (
                  <div key={s.id} className="service">
                    {body}
                  </div>
                );
              })}
            </div>
            <Pager page={paged.page} pageSize={pageSize} total={paged.total} onPage={paged.setPage} />
          </>
        )}
      </div>
    </>
  );
}
