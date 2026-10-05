import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, errorText, type Group, type SessionInfo, type User } from "../../api";
import { useAuth } from "../../auth";
import { ago, browserName, Drawer, Field, Notice, useFeedback } from "../../components/ui";

type UserDetail = User & { recovery_codes_left: number; sessions: SessionInfo[] };

export function Seals({ groups }: { groups: { id: number; name: string }[] }) {
  if (!groups.length) return <span className="muted">без групп</span>;
  return (
    <span className="seals">
      {groups.map((g) => (
        <span key={g.id} className={g.name === "admins" ? "seal seal-admins" : "seal"}>
          {g.name}
        </span>
      ))}
    </span>
  );
}

export function GroupPicker({
  groups,
  value,
  onChange,
}: {
  groups: Group[];
  value: number[];
  onChange: (ids: number[]) => void;
}) {
  if (!groups.length) return <p className="muted">Групп пока нет.</p>;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {groups.map((g) => (
        <label key={g.id} className="check">
          <input
            type="checkbox"
            checked={value.includes(g.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, g.id] : value.filter((id) => id !== g.id))}
          />
          <span>
            {g.name}
            {g.description && <small>{g.description}</small>}
          </span>
        </label>
      ))}
    </div>
  );
}

function CreateUser({ groups, onDone, onClose }: { groups: Group[]; onDone: () => void; onClose: () => void }) {
  const [form, setForm] = useState({ username: "", display_name: "", email: "", password: "" });
  const [groupIds, setGroupIds] = useState<number[]>([]);
  const [error, setError] = useState("");
  const { toast } = useFeedback();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api.post("/api/admin/users", { ...form, email: form.email || null, group_ids: groupIds });
      toast(`${form.display_name} может входить в Bastion`);
      onDone();
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Drawer title="Новый человек" subtitle="При первом входе Bastion попросит привязать телефон." onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <Field label="Логин" required autoCapitalize="none" spellCheck={false} value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })} hint="Латиница, цифры, точка, дефис" />
        <Field label="Имя" required value={form.display_name}
          onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
        <Field label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Field label="Временный пароль" type="password" autoComplete="new-password" required minLength={10}
          value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
          hint="Передайте его лично. Сменить можно в профиле после входа." />
        <div className="field">
          <span className="field-label">Группы</span>
          <GroupPicker groups={groups} value={groupIds} onChange={setGroupIds} />
        </div>
        <Notice>{error}</Notice>
        <div><button className="btn" type="submit">Добавить человека</button></div>
      </form>
    </Drawer>
  );
}

function EditUser({
  userId,
  groups,
  onDone,
  onClose,
}: {
  userId: string;
  groups: Group[];
  onDone: () => void;
  onClose: () => void;
}) {
  const { me } = useAuth();
  const { confirm, toast } = useFeedback();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [form, setForm] = useState({ display_name: "", email: "" });
  const [groupIds, setGroupIds] = useState<number[]>([]);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const u = await api.get<UserDetail>(`/api/admin/users/${userId}`);
    setUser(u);
    setForm({ display_name: u.display_name, email: u.email ?? "" });
    setGroupIds(u.groups.map((g) => g.id));
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) return null;
  const self = user.id === me?.id;

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setError("");
    try {
      await fn();
      toast(done);
      await load();
      onDone();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    void act(
      () => api.patch(`/api/admin/users/${user.id}`, { ...form, email: form.email || null, group_ids: groupIds }),
      "Изменения сохранены",
    );
  };

  const setPw = (e: FormEvent) => {
    e.preventDefault();
    void act(async () => {
      await api.post(`/api/admin/users/${user.id}/password`, { password });
      setPassword("");
    }, "Пароль задан");
  };

  const resetTotp = async () => {
    const ok = await confirm({
      title: "Отвязать телефон?",
      body: `${user.display_name} выйдет со всех устройств и при следующем входе заново отсканирует QR-код. Резервные коды сгорят.`,
      action: "Отвязать телефон",
      danger: true,
    });
    if (ok) await act(() => api.post(`/api/admin/users/${user.id}/reset-totp`), "Телефон отвязан");
  };

  const toggleActive = async () => {
    if (user.is_active) {
      const ok = await confirm({
        title: "Отключить вход?",
        body: `${user.display_name} выйдет со всех устройств и не сможет войти, пока вы не включите вход обратно.`,
        action: "Отключить",
        danger: true,
      });
      if (!ok) return;
    }
    await act(
      () => api.patch(`/api/admin/users/${user.id}`, { is_active: !user.is_active }),
      user.is_active ? "Вход отключён" : "Вход включён",
    );
  };

  const signOut = () => act(() => api.post(`/api/admin/users/${user.id}/sign-out`), "Все сеансы завершены");

  const remove = async () => {
    const ok = await confirm({
      title: `Удалить ${user.display_name}?`,
      body: "Учётная запись, привязка телефона и сеансы удалятся навсегда. Сервисы перестанут пускать этого человека.",
      action: "Удалить навсегда",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/admin/users/${user.id}`);
      toast("Удалено");
      onDone();
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Drawer
      title={user.display_name}
      subtitle={`${user.username}, последний вход ${ago(user.last_login_at)}`}
      onClose={onClose}
    >
      <Notice>{error}</Notice>
      <form className="form-stack" onSubmit={save}>
        <Field label="Имя" required value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
        <Field label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <div className="field">
          <span className="field-label">Группы</span>
          <GroupPicker groups={groups} value={groupIds} onChange={setGroupIds} />
        </div>
        <div><button className="btn" type="submit">Сохранить</button></div>
      </form>

      <div className="drawer-block">
        <h3>Пароль</h3>
        <form className="form-stack" onSubmit={setPw}>
          <Field label="Новый пароль" type="password" autoComplete="new-password" required minLength={10}
            value={password} onChange={(e) => setPassword(e.target.value)}
            hint={self ? undefined : "Человек выйдет со всех устройств."} />
          <div><button className="btn btn-quiet" type="submit">Задать пароль</button></div>
        </form>
      </div>

      <div className="drawer-block">
        <h3>Телефон и сеансы</h3>
        <p className="muted">
          {user.totp_enrolled
            ? `Телефон привязан, резервных кодов: ${user.recovery_codes_left}.`
            : "Телефон ещё не привязан — привяжет при первом входе."}{" "}
          Активных сеансов: {user.sessions.length}.
        </p>
        {user.sessions.slice(0, 4).map((s) => (
          <p key={s.id} className="muted" style={{ fontSize: "0.875rem" }}>
            {browserName(s.user_agent)}, {s.ip ?? "адрес неизвестен"}, {ago(s.last_seen_at)}
          </p>
        ))}
        <div className="row-actions">
          {user.totp_enrolled && (
            <button className="btn btn-quiet btn-small" type="button" onClick={resetTotp}>Отвязать телефон</button>
          )}
          {user.sessions.length > 0 && (
            <button className="btn btn-quiet btn-small" type="button" onClick={signOut}>Завершить все сеансы</button>
          )}
        </div>
      </div>

      {!self && (
        <div className="drawer-block">
          <h3>Доступ</h3>
          <div className="row-actions">
            <button className="btn btn-quiet btn-small" type="button" onClick={toggleActive}>
              {user.is_active ? "Отключить вход" : "Включить вход"}
            </button>
            <button className="btn btn-danger btn-small" type="button" onClick={remove}>Удалить</button>
          </div>
        </div>
      )}
    </Drawer>
  );
}

export function UsersPage() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [u, g] = await Promise.all([api.get<User[]>("/api/admin/users"), api.get<Group[]>("/api/admin/groups")]);
    setUsers(u);
    setGroups(g);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const withoutTotp = users?.filter((u) => u.is_active && !u.totp_enrolled).length ?? 0;

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="page-title">Люди</h1>
          <p className="page-lead">Все, кто может входить через Bastion. Доступ к сервисам дают группы.</p>
        </div>
        <button className="btn" type="button" onClick={() => setCreating(true)}>Добавить человека</button>
      </header>

      {withoutTotp > 0 && (
        <div style={{ marginBottom: 20 }}>
          <Notice kind="info">
            Ждут привязки телефона: {withoutTotp}. Привязка пройдёт при их первом входе.
          </Notice>
        </div>
      )}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Человек</th>
              <th>Группы</th>
              <th>Телефон</th>
              <th>Последний вход</th>
            </tr>
          </thead>
          <tbody>
            {users?.map((u) => (
              <tr key={u.id} className="clickable" onClick={() => setEditing(u.id)}>
                <td>
                  <button type="button" className="link-button primary" style={{ textDecoration: "none", color: "inherit" }}
                    onClick={(e) => { e.stopPropagation(); setEditing(u.id); }}>
                    {u.display_name}
                  </button>
                  <span className="secondary">{u.username}{u.email ? `, ${u.email}` : ""}</span>
                </td>
                <td><Seals groups={u.groups} /></td>
                <td>
                  {!u.is_active ? (
                    <span className="status status-off">вход отключён</span>
                  ) : u.totp_enrolled ? (
                    <span className="status">привязан</span>
                  ) : (
                    <span className="status status-warn">ждёт привязки</span>
                  )}
                </td>
                <td className="num">{ago(u.last_login_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && <CreateUser groups={groups} onDone={load} onClose={() => setCreating(false)} />}
      {editing && <EditUser userId={editing} groups={groups} onDone={load} onClose={() => setEditing(null)} />}
    </>
  );
}
