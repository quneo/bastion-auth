import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Mark } from "./Mark";

export function Shell() {
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
        <NavLink to="/" className="rail-brand" aria-label="Bastion, на главную">
          <Mark />
          <span>Bastion</span>
        </NavLink>
        <nav aria-label="Основная навигация">
          <NavLink to="/" end className={link}>
            Сервисы
          </NavLink>
          <NavLink to="/account" className={link}>
            Профиль и вход
          </NavLink>
          {me.is_admin && (
            <>
              <p className="rail-heading">Администрирование</p>
              <NavLink to="/admin/users" className={link}>
                Люди
              </NavLink>
              <NavLink to="/admin/groups" className={link}>
                Группы
              </NavLink>
              <NavLink to="/admin/projects" className={link}>
                Проекты
              </NavLink>
              <NavLink to="/admin/audit" className={link}>
                Журнал входов
              </NavLink>
            </>
          )}
        </nav>
        <div className="rail-foot">
          <div className="rail-user">
            {me.display_name}
            <small>{me.username}</small>
          </div>
          <button className="btn btn-quiet btn-small" type="button" onClick={signOut}>
            Выйти
          </button>
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
