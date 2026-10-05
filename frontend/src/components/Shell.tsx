import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { LangSwitch, useI18n } from "../i18n";
import { Mark } from "./Mark";

export function Shell() {
  const { t } = useI18n();
  const { me, refresh } = useAuth();
  const navigate = useNavigate();
  if (!me) return null;

  const signOut = async () => {
    await api.post("/api/auth/logout").catch(() => undefined);
    await refresh();
    navigate("/login?signed_out=1", { replace: true });
  };

  const link = ({ isActive }: { isActive: boolean }) => (isActive ? "rail-link active" : "rail-link");

  return (
    <div className="shell">
      <aside className="rail">
        <NavLink to="/" className="rail-brand" aria-label={t("nav.home")}>
          <Mark />
          <span>Bastion</span>
        </NavLink>
        <nav aria-label={t("nav.main")}>
          <NavLink to="/" end className={link}>
            {t("nav.services")}
          </NavLink>
          <NavLink to="/account" className={link}>
            {t("nav.account")}
          </NavLink>
          {me.is_admin && (
            <>
              <p className="rail-heading">{t("nav.admin")}</p>
              <NavLink to="/admin/users" className={link}>
                {t("nav.people")}
              </NavLink>
              <NavLink to="/admin/groups" className={link}>
                {t("nav.groups")}
              </NavLink>
              <NavLink to="/admin/projects" className={link}>
                {t("nav.projects")}
              </NavLink>
              <NavLink to="/admin/audit" className={link}>
                {t("nav.audit")}
              </NavLink>
            </>
          )}
        </nav>
        <div className="rail-foot">
          <div className="rail-user">
            {me.display_name}
            <small>{me.username}</small>
          </div>
          <div className="row-actions">
            <button className="btn btn-quiet btn-small" type="button" onClick={signOut}>
              {t("nav.signOut")}
            </button>
            <LangSwitch />
          </div>
        </div>
      </aside>
      <main className="sheet">
        <div className="sheet-inner">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
